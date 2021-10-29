import fs from 'fs';
import path from 'path';
import tmp from 'tmp';
import fse from 'fs-extra';
import rimraf from 'rimraf';
import gitP, { SimpleGit } from 'simple-git/promise';

import { main } from '../src/main';

import type { ICore } from '../src/main';

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
    const jestBin = path.join(__dirname, '../node_modules/.bin/jest');

    const core: ICore = {
        error: (message, properties) => console.error(message),
        info: (message) => console.info(message),
        group: <T>(name: string, fn: () => Promise<T>): Promise<T> => {
            return fn();
        },
    };

    await main(jestBin, workingDirectory, 'warning', baseRef, core);
};
