import path from 'path';

import { createRepo } from '../git-fixture';

import type { Fixture } from '../git-fixture';

describe('#createRepo', () => {
    it('handle files with added lines', async () => {
        const baseDir = path.join(__dirname, '../__fixtures__/added-lines/base');
        const headDir = path.join(__dirname, '../__fixtures__/added-lines/head');
        const result = await createRepo(baseDir, headDir);

        result.removeCallback();
    });

    it('renamed files with no content changes', async () => {
        const baseDir = path.join(__dirname, '../__fixtures__/renamed-file/base');
        const headDir = path.join(__dirname, '../__fixtures__/renamed-file/head');
        const result = await createRepo(baseDir, headDir);

        result.removeCallback();
    });
});
