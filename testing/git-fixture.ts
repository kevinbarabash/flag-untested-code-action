import fs from 'fs';
import path from 'path';
import tmp from 'tmp';
import fse from 'fs-extra';
import rimraf from 'rimraf';
import gitP, {SimpleGit} from 'simple-git/promise';
import { execSync } from 'child_process';

import gitChangedFiles from '../src/utils/git-changed-files';

type File = {
    path: string,
    contents: string,
};

export type Fixture = {
    base: File[],
    head: File[],
};

export const createRepo = async (baseDir: string, headDir: string) => {
    const result = tmp.dirSync({ unsafeCleanup: true });

    console.log(result.name);

    // Create .gitiginore
    fs.writeFileSync(
        path.join(result.name, '.gitignore'),
        'node_modules\n',
    );
    // Symlink node_modules back to the node_modules in this repo
    fs.symlinkSync(
        path.join(__dirname, '../node_modules'),
        path.join(result.name, 'node_modules'),
    );

    const git: SimpleGit = gitP(result.name);
    await git.init();

    // Copy files from the BASE_REF directory
    fse.copySync(baseDir, result.name);
    await git.add('.');
    await git.commit('base commit');
    await git.checkout({'-b': 'my-branch'});

    // Delete files before re-adding them so that our fixtures can handle
    // mocking situations where files are renamed or deleted.
    const files = fs.readdirSync(result.name, {encoding: 'utf-8'});
    const filesToKeep = ['.gitignore', 'node_modules', '.git'];
    const filesToDelete = files.filter(file => !filesToKeep.includes(file));
    for (const file of filesToDelete) {
        rimraf.sync(path.join(result.name, file));
    }

    // Copy files from the HEAD directory
    fse.copySync(headDir, result.name);
    await git.add('.');
    await git.commit('head commit');

    const changedFiles = await gitChangedFiles('master', result.name);
    console.log(`changed files:\n${changedFiles.join('\n')}`);

    // Using --name-only is insufficient to track renamed files.
    // TODO: switch to using --name-status instead
    // See https://git-scm.com/docs/git-status#_short_format
    const rawChangedFiles = execSync(`git diff --name-only master --relative`, {
        cwd: result.name,
        encoding: 'utf8',
    });
    console.log(`rawChangedFiles =\n${rawChangedFiles}`);

    const baseRef = 'master';
    for (const file of changedFiles) {
        const diff = execSync(
            `git difftool ${baseRef} -y -x "diff -C0" ${file}`,
            { encoding: 'utf-8', cwd: result.name },
        );    
        console.log(`diff of ${file} for master..my-branch`);
        console.log(diff);
    }

    return result;
};
