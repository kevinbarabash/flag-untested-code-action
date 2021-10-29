import path from 'path';

import { createRepo } from '../git-fixture';
import { main } from '../../src/main';

import type { ICore } from '../../src/main';

const jestBin = path.join(__dirname, '../../node_modules/.bin/jest');

const core: ICore = {
    error: (message, properties) => console.error(message),
    info: (message) => console.info(message),
    group: <T>(name: string, fn: () => Promise<T>): Promise<T> => {
        return fn();
    },
};

describe('#createRepo', () => {
    it('handle files with added lines', async () => {
        const baseDir = path.join(
            __dirname,
            '../__fixtures__/added-lines/base',
        );
        const headDir = path.join(
            __dirname,
            '../__fixtures__/added-lines/head',
        );

        const result = await createRepo(baseDir, headDir);
        const baseRef = 'master';
        const workingDirectory = result.name;

        try {
            const { deltaReport, summaryLines, messages } = await main(
                jestBin,
                workingDirectory,
                'warning',
                baseRef,
                core,
            );
            
            // TODO: assert some things about deltaReport, summaryLines, messages
        } finally {
            // always cleanup the temp directory
            result.removeCallback();
        }
    });
});
