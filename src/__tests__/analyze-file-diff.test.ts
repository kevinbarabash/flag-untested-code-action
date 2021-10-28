import { computeFileChanges } from '../analyze-file-diff';
import { lao, tzu, diff } from '../__fixtures__/testdata';

// NOTE: computeFileChanges uses 1 based indices, hence all of the - 1s.

describe('analyze-file-diff', () => {
    it('should report added lines', () => {
        const result = computeFileChanges(lao, diff);
        
        const headLines = tzu.split('\n');
        const addedLines = result.added.map(index => headLines[index - 1]);

        expect(addedLines).toEqual([
            'They both may be called deep and profound.',
            'Deeper and more profound,',
            'The door of all subtleties!',
        ]);
    });

    it('should report modified lines', () => {
        const result = computeFileChanges(lao, diff);
        
        const headLines = tzu.split('\n');
        const modifiedLines = result.modified.map(index => headLines[index - 1]);

        expect(modifiedLines).toEqual([
            'The named is the mother of all things.',
            '',
        ]);
    });

    it('should report unchanged line mappings', () => {
        const result = computeFileChanges(lao, diff);

        const baseLines = lao.split('\n');
        const headLines = tzu.split('\n');

        for (const [from, to] of result.unchangedLineMappings) {
            expect(baseLines[from - 1]).toEqual(headLines[to - 1]);
        }
    });
});
