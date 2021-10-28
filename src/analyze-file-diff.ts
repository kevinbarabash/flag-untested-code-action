export type FileChanges = {
    added: number[]; // head indexes
    modified: number[]; // head indexes
    // mapping from base indexes to head indexes
    unchangedLineMappings: [number, number][];
};

type Range = { start: number; end: number };

const parseSeparator = (separator: string, regex: RegExp): Range => {
    let match = separator.match(regex);
    if (!match) {
        throw new Error('invalid before separator');
    }
    const start = parseInt(match[1]);
    const end = parseInt(match[3]) || start;
    return { start, end };
};

const rangeLength = (range: Range): number => {
    return range.end - range.start + 1;
};

export const computeFileChanges = (
    base: string, // contents of the file in the base ref
    diff: string, // context diff between base ref and head
): FileChanges => {
    const changes: FileChanges = {
        added: [],
        modified: [],
        unchangedLineMappings: [],
    };

    // we skip the first section since that only contains the filename
    const sections = diff
        .split('***************\n')
        .slice(1)
        .map((section) => section.trim().split('\n'));

    // NOTES:
    // - line numbers start at 1
    // - in between sections, there will be a constant offset to map
    //   line numbers from base to head, initial this offset will be 0
    // - sections can come in three flavors: deletions, modifications, and additions

    let baseLine = 1;
    let headLine = 1;

    const afterLineRegex = /^--- (\d+)(,(\d+))? ----$/;
    const beforeLineRegex = /^\*\*\* (\d+)(,(\d+))? \*\*\*\*$/;

    for (const section of sections) {
        const beforeSeparator = section[0];
        const afterSeparatorIndex = section.findIndex((line) =>
            afterLineRegex.test(line),
        );
        const afterSeparator = section[afterSeparatorIndex];

        const beforeRange = parseSeparator(beforeSeparator, beforeLineRegex);
        const afterRange = parseSeparator(afterSeparator, afterLineRegex);

        while (baseLine < beforeRange.start) {
            changes.unchangedLineMappings.push([baseLine, headLine]);
            baseLine++;
            headLine++;
        }

        const beforeLines = section.slice(1, afterSeparatorIndex);
        const afterLines = section.slice(afterSeparatorIndex + 1);

        if (beforeLines.length === 0) {
            // handle "add" section
            headLine += rangeLength(afterRange);
            for (let i = afterRange.start; i < afterRange.end + 1; i++) {
                changes.added.push(i);
            }
        } else if (afterLines.length === 0) {
            // handle "delete" section
            baseLine += rangeLength(beforeRange);
        } else {
            // handle "modify" section
            baseLine += rangeLength(beforeRange);
            headLine += rangeLength(afterRange);
            for (let i = afterRange.start; i < afterRange.end + 1; i++) {
                changes.modified.push(i);
            }
        }
    }

    // handle any trailing lines that haven't changed
    const baseLines = base.split('\n');
    while (baseLine < baseLines.length) {
        changes.unchangedLineMappings.push([baseLine, headLine]);
        baseLine++;
        headLine++;
    }

    return changes;
};
