import path from 'path';
import fs from 'fs';
import minimatch from 'minimatch';
import {exec} from 'child_process';
import {promisify} from 'util';

const execProm = promisify(exec);

function isNotNull<T> (arg: T | null): arg is T {
    return arg !== null
}
  
// ok
const getIgnoredPatterns = (fileContents: string): string[] => {
    return fileContents
        .split('\n')
        .map(line => {
            if (line.startsWith('#')) {
                return null;
            }
            if (line.startsWith('"')) {
                throw new Error('Quoted patterns not yet supported, sorry');
            }
            if (!line.trim()) {
                return null;
            }
            const [pattern, ...attributes] = line.trim().split(' ');
            if (attributes.includes('binary') || attributes.includes('linguist-generated=true')) {
                return pattern;
            }
            return null;
        })
        .filter(isNotNull);
};

const ignoredPatternsByDirectory: Record<string, string[]> = {};
const isFileIgnored = (workingDirectory: string, file: string) => {
    // If it's outside of the "working directory", we ignore it
    if (!file.startsWith(workingDirectory)) {
        return true;
    }
    let dir = path.dirname(file);
    let name = path.basename(file);
    while (dir.startsWith(workingDirectory)) {
        if (!ignoredPatternsByDirectory[dir]) {
            const attributes = path.join(dir, '.gitattributes');
            if (fs.existsSync(attributes)) {
                ignoredPatternsByDirectory[dir] = getIgnoredPatterns(
                    fs.readFileSync(attributes, 'utf8'),
                );
            } else {
                ignoredPatternsByDirectory[dir] = [];
            }
        }
        for (const pattern of ignoredPatternsByDirectory[dir]) {
            if (minimatch(name, pattern)) {
                return true;
            }
        }
        name = path.join(path.basename(dir), name);
        dir = path.dirname(dir);
    }
    if (file === workingDirectory) {
        return true;
    }
    return false;
};

/**
 * This lists the files that have changed when compared to `base` (a git ref),
 * limited to the files that are a descendent of `cwd`.
 * It also respects '.gitattributes', filtering out files that have been marked
 * as "binary" or "linguist-generated=true".
 */
const gitChangedFiles = async (base: string, cwd: string): Promise<string[]> => {
    cwd = path.resolve(cwd);

    // Github actions jobs can run the following steps to get a fully accurate
    // changed files list. Otherwise, we fallback to a simple diff between the
    // current and base branch, which might give false positives if the base
    // is ahead of the current branch.
    //
    //   - name: Get All Changed Files
    //     uses: jaredly/get-changed-files@absolute
    //     id: changed
    //     with:
    //       format: 'json'
    //       absolute: true
    //
    //   - uses: allenevans/set-env@v2.0.0
    //     with:
    //       ALL_CHANGED_FILES: '${{ steps.changed.outputs.added_modified }}'
    //
    if (process.env.ALL_CHANGED_FILES) {
        const files: string[] = JSON.parse(process.env.ALL_CHANGED_FILES);
        return files.filter(path => !isFileIgnored(cwd, path));
    }

    const {stdout} = await execProm(`git diff --name-only ${base} --relative`, {
        cwd,
        encoding: 'utf8',
    });
    return (
        stdout
            .split('\n')
            .filter(isNotNull)
            .map((name: string) => path.join(cwd, name))
            // Filter out paths that were deleted
            .filter((path: string) => fs.existsSync(path))
            .filter((path: string) => !isFileIgnored(cwd, path))
    );
};

export default gitChangedFiles;
