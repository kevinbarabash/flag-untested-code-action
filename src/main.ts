import fs from 'fs';
import path from 'path';
import { exec, execSync, spawn } from 'child_process';
import { promisify } from 'util';

import gitChangedFiles from './utils/git-changed-files';
import { getUncoveredLines } from './coverage-report';
import { computeFileChanges } from './analyze-file-diff';
import { compareReports } from './delta-report';

import type { AnnotationProperties } from '@actions/core';
import type { Message } from './utils/send-report';
import type { CoverageReport } from './coverage-report';

const execProm = promisify(exec);

export interface ICore {
    error(
        message: string | Error,
        properties?: AnnotationProperties | undefined,
    ): void;
    info(message: string): void;

    group<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

const runJest = (
    jestBin: string,
    jestOpts: string[],
    spawnOpts: any,
    core: ICore,
): Promise<void> => {
    return new Promise((resolve, reject) => {
        core.info(`running ${jestBin} ${jestOpts.join(' ')}`);
        const jest = spawn(jestBin, jestOpts, spawnOpts);

        jest.stdout.on('data', (data) => {
            core.info(data.toString());
        });

        jest.stderr.on('data', (data) => {
            // jest uses stderr for all its output unfortunately
            // https://github.com/facebook/jest/issues/5064
            core.info(data.toString());
        });

        jest.on('close', (code) => {
            // Jest will exit with a non-zero exit code if any test fails.
            // This is normal so we don't bother logging error code.
            resolve();
        });
    });
};

const makePathsRelative = (
    report: CoverageReport,
    repoRoot: string,
): CoverageReport => {
    const newReport: CoverageReport = {};
    for (const [filename, fileCoverage] of Object.entries(report)) {
        const filepath = filename.startsWith('/private/var/')
            ? filename.replace('/private/var/', '/var/')
            : filename;
        const relFilename = path.relative(repoRoot, filepath);
        newReport[relFilename] = {
            ...fileCoverage,
            path: relFilename,
        };
    }
    return newReport;
};

const LINE_ADDED = 'This line was added but is untested.';
const LINES_ADDED = 'These lines were added but are untested.';
const LINE_MODIFIED = 'This line was modified but is untested.';
const LINES_MODIFIED = 'These lines were modified but are untested.';
const UNCHANGED_LINE_BECAME_UNTESTED =
    'This unchanged line is no longer being tested.';
const UNCHANGED_LINES_BECAME_UNTESTED =
    'These unchanged lines are no longer being tested.';

export const main = async (
    jestBin: string | null,
    workingDirectory: string,
    repoRoot: string,
    annotationLevel: 'warning' | 'failure',
    baseRef: string | null,
    core: ICore,
) => {
    if (!jestBin) {
        core.info(
            `You need to have jest installed, and pass in the the jest binary via the variable 'jest-bin'.`,
        );
        process.exit(1);
    }

    if (!baseRef) {
        core.info(`No base ref given`);
        process.exit(1);
    }

    const files = await gitChangedFiles(baseRef, workingDirectory, repoRoot);

    const validExt = ['.js', '.jsx', '.mjs', '.ts', '.tsx'];
    const jsFiles = files.filter((file) =>
        validExt.includes(path.extname(file)),
    );

    if (!jsFiles.length) {
        core.info('No JavaScript files changed');
        process.exit(1);
    }

    core.info('changed files: \n' + jsFiles.join('\n'));
    const nonImplRegex = /(_test|\.test|\.fixture|\.stories)\.jsx?$/;
    const jsImplFiles = jsFiles.filter((file) => !nonImplRegex.test(file));

    // Get file changes before we switch branches
    // const fileChanges: Record<string, FileChanges> = {};

    // TODO: handle new files
    const fileDiffs: Record<string, string> = {}; // filename -> diff
    for (const file of jsImplFiles) {
        const diff = execSync(
            `git difftool ${baseRef} -y -x "diff -C0" ${file}`,
            { encoding: 'utf-8', cwd: workingDirectory },
        );
        fileDiffs[file] = diff;
    }
    // for (const file of jsImplFiles) {
    //     fileChanges[file] = getFileChanges(file, baseRef);
    // }

    const jsTestFiles: string[] = jsImplFiles.flatMap((file) => {
        const dirname = path.dirname(file);
        const basename = path.basename(file).replace(/\.jsx?$/, '');

        const filenames = [
            path.join(dirname, `${basename}_test.js`),
            path.join(dirname, `${basename}_test.jsx`),
            path.join(dirname, `${basename}.test.js`),
            path.join(dirname, `${basename}.test.jsx`),
            path.join(dirname, '__tests__', `${basename}_test.js`),
            path.join(dirname, '__tests__', `${basename}_test.jsx`),
            path.join(dirname, '__tests__', `${basename}.test.js`),
            path.join(dirname, '__tests__', `${basename}.test.jsx`),
        ];

        for (const filename of filenames) {
            if (fs.existsSync(filename)) {
                return [filename];
            }
        }

        return [];
    });
    core.info('matching tests: \n' + jsTestFiles.join('\n'));

    const testFileRegex = /(_test|\.test)\.jsx?$/;
    const changedTestFiles = jsFiles.filter((file) => testFileRegex.test(file));
    // running tests twice to get coverage deltas
    // - a test file was changed (we can determine this by running git diff-tool on the file in question)
    // - a test file was deleted (should only happen when the implementation file was deleted)

    const jestOpts = ['--coverage', ...jsTestFiles];

    try {
        await core.group('Running jest on HEAD', async () => {
            await runJest(jestBin, jestOpts, { cwd: workingDirectory }, core);
        });
    } catch (err) {
        core.error('An error occurred trying to run jest');
        // @ts-expect-error: err is typed as mixed
        core.error(err);
        process.exit(1);
    }

    core.info('Parsing json output from jest');

    const reportPath = path.join(
        workingDirectory,
        'coverage/coverage-final.json',
    );
    const headReport = makePathsRelative(
        JSON.parse(fs.readFileSync(reportPath, 'utf-8')),
        repoRoot,
    );
    console.log(headReport);

    await execProm(`git checkout ${baseRef}`, { cwd: workingDirectory });

    try {
        await core.group(`Running jest on ${baseRef}`, async () => {
            await runJest(jestBin, jestOpts, { cwd: workingDirectory }, core);
        });
    } catch (err) {
        core.error('An error occurred trying to run jest');
        // @ts-expect-error: err is typed as mixed
        core.error(err);
        process.exit(1);
    }

    const baseReport = makePathsRelative(
        JSON.parse(fs.readFileSync(reportPath, 'utf-8')),
        repoRoot,
    );

    const deltaReport = compareReports(baseReport, headReport);

    console.log('deltaReport');
    console.log(JSON.stringify(deltaReport, null, 4));

    const uncoveredHeadLines = getUncoveredLines(headReport);
    const uncoveredBaseLines = getUncoveredLines(baseReport);
    const messages: Message[] = [];

    console.log('determing added/changed lines in implementation files');
    core.info('jsImplFiles: ' + jsImplFiles.join(', '));
    for (const filename of jsImplFiles) {
        // TODO: check if the file exists before trying to read it
        const baseFileContents = fs.readFileSync(
            path.join(repoRoot, filename),
            {
                encoding: 'utf-8',
            },
        );
        const diff = fileDiffs[filename];
        const changes = computeFileChanges(baseFileContents, diff);
        core.info(`changes for ${filename}`);
        core.info(JSON.stringify(changes, null, 4));
        core.info(`uncovered lines for ${filename}`);
        const lines: number[] = uncoveredHeadLines[filename];
        console.log(lines.join('\n'));

        lines.forEach((line: number) => {
            if (changes.added.includes(line)) {
                const lastMessage = messages[messages.length - 1];
                if (
                    lastMessage &&
                    lastMessage.endLine === line - 1 &&
                    lastMessage.message === LINE_ADDED
                ) {
                    lastMessage.endLine = line;
                } else {
                    messages.push({
                        path: path.relative(path.resolve('.'), filename),
                        startLine: line,
                        endLine: line,
                        annotationLevel,
                        message: LINE_ADDED,
                    });
                }
            }
        });

        lines.forEach((line: number) => {
            if (changes.modified.includes(line)) {
                const lastMessage = messages[messages.length - 1];
                if (
                    lastMessage &&
                    lastMessage.endLine === line - 1 &&
                    lastMessage.message
                ) {
                    lastMessage.endLine = line;
                } else {
                    messages.push({
                        path: path.relative(path.resolve('.'), filename),
                        startLine: line,
                        endLine: line,
                        annotationLevel,
                        message: LINE_MODIFIED,
                    });
                }
            }
        });

        core.info(
            `uncoveredBaseLines[${filename}] = ${uncoveredBaseLines[
                filename
            ].join(', ')}`,
        );
        core.info(
            `uncoveredHeadLines[${filename}] = ${uncoveredHeadLines[
                filename
            ].join(', ')}`,
        );

        core.info(JSON.stringify(headReport, null, 4));

        for (const [from, to] of changes.unchangedLineMappings) {
            core.info(`from = ${from}, to = ${to}`);
            if (
                !uncoveredBaseLines[filename].includes(from) &&
                uncoveredHeadLines[filename].includes(to)
            ) {
                const lastMessage = messages[messages.length - 1];
                const line = to;
                if (
                    lastMessage &&
                    lastMessage.endLine === line - 1 &&
                    lastMessage.message
                ) {
                    lastMessage.endLine = line;
                } else {
                    messages.push({
                        path: path.relative(path.resolve('.'), filename),
                        startLine: line,
                        endLine: line,
                        annotationLevel,
                        message: UNCHANGED_LINE_BECAME_UNTESTED,
                    });
                }
            }
        }

        messages.forEach((message) => {
            if (message.endLine - message.startLine > 0) {
                if (message.message === LINE_ADDED) {
                    message.message = LINES_ADDED;
                } else if (message.message === LINE_MODIFIED) {
                    message.message = LINES_MODIFIED;
                } else if (message.message === UNCHANGED_LINE_BECAME_UNTESTED) {
                    message.message = UNCHANGED_LINES_BECAME_UNTESTED;
                }
            }
        });
    }

    const summaryLines = [
        `## Coverage deltas`,
        `|file|% change|lines covered|lines uncovered|`,
        `|-|-|-|-|`,
    ];

    for (const [file, delta] of Object.entries(deltaReport)) {
        // TODO: if any test files change without their implementation file also
        // changing, include that implementation file in the list of implementation
        // files to report on.
        if (jsImplFiles.includes(file)) {
            const { percent, covered, uncovered } = delta;
            const relFile = path.relative(path.resolve('.'), file);
            summaryLines.push(
                `|${relFile}|${(percent * 100).toFixed(
                    2,
                )}|${covered}|${uncovered}|`,
            );
        }
    }

    return { deltaReport, messages, summaryLines };
};
