import fs from 'fs';
import path from 'path';
import tmp from 'tmp';
import fse from 'fs-extra';
import rimraf from 'rimraf';
import gitP, { SimpleGit } from 'simple-git/promise';
import { execSync, spawnSync } from 'child_process';

import gitChangedFiles from '../src/utils/git-changed-files';

type File = {
    path: string;
    contents: string;
};

export type Fixture = {
    base: File[];
    head: File[];
};

export const createRepo = async (
    baseDir: string,
    headDir: string,
): Promise<tmp.DirResult> => {
    const result = tmp.dirSync({ unsafeCleanup: true });

    console.log(result.name);

    // Create .gitiginore
    fs.writeFileSync(
        path.join(result.name, 'jest.config.js'),
        'module.exports = {};\n',
    );

    const git: SimpleGit = gitP(result.name);
    await git.init();

    // Copy files from the BASE_REF directory
    fse.copySync(baseDir, result.name);
    await git.add('.');
    await git.commit('base commit');
    await git.checkout({ '-b': 'my-branch' });

    // Delete files before re-adding them so that our fixtures can handle
    // mocking situations where files are renamed or deleted.
    const files = fs.readdirSync(result.name, { encoding: 'utf-8' });
    const filesToKeep = ['.git', 'jest.config.js'];
    const filesToDelete = files.filter((file) => !filesToKeep.includes(file));
    for (const file of filesToDelete) {
        rimraf.sync(path.join(result.name, file));
    }

    // Copy files from the HEAD directory
    fse.copySync(headDir, result.name);
    await git.add('.');
    await git.commit('head commit');

    return result;
};

export const runTest = async (baseRef: string, workingDirectory: string) => {
    const changedFiles = await gitChangedFiles('master', workingDirectory);
    console.log(`changed files:\n${changedFiles.join('\n')}`);

    // Using --name-only is insufficient to track renamed files.
    // TODO: switch to using --name-status instead
    // See https://git-scm.com/docs/git-status#_short_format
    const rawChangedFiles = execSync(`git diff --name-only master --relative`, {
        cwd: workingDirectory,
        encoding: 'utf8',
    });
    console.log(`rawChangedFiles =\n${rawChangedFiles}`);

    for (const file of changedFiles) {
        const diff = execSync(
            `git difftool ${baseRef} -y -x "diff -C0" ${file}`,
            { encoding: 'utf-8', cwd: workingDirectory },
        );
        console.log(`diff of ${file} for master..my-branch`);
        console.log(diff);
    }

    // TODO: refactor action so that we can pass in the jest-bin path ourselves
    const jestPath = path.join(__dirname, '../node_modules/.bin/jest');
    const jestResult = spawnSync(jestPath, ['--coverage'], {
        encoding: 'utf-8',
        cwd: workingDirectory,
    });

    const coverageReport = JSON.parse(
        fs.readFileSync(
            path.join(workingDirectory, 'coverage', 'coverage-final.json'),
            { encoding: 'utf-8' },
        ),
    );

    console.log(coverageReport);
};
