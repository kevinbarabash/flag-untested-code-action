import path from 'path';

import { createRepo, runTest } from '../git-fixture';

describe('#createRepo', () => {
    it('handle files with added lines', async () => {
        const baseDir = path.join(__dirname, '../__fixtures__/added-lines/base');
        const headDir = path.join(__dirname, '../__fixtures__/added-lines/head');
        
        const result = await createRepo(baseDir, headDir);
        const baseRef = 'master';
        const workingDirectory = result.name;

        try {
            await runTest(baseRef, workingDirectory);
        } finally {
            // always cleanup the temp directory
            result.removeCallback();
        }
    });

    it.skip('renamed files with no content changes', async () => {
        const baseDir = path.join(__dirname, '../__fixtures__/renamed-file/base');
        const headDir = path.join(__dirname, '../__fixtures__/renamed-file/head');
        const result = await createRepo(baseDir, headDir);

        result.removeCallback();
    });
});
