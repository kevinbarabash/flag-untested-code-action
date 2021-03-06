import * as core from '@actions/core';

import { execSync } from 'child_process';

export type FileChanges = {
    added: number[];
    modified: number[];
};

export const getFileChanges = (
    filename: string,
    baseRef: string,
): FileChanges => {
    const changes: FileChanges = {
        added: [],
        modified: [],
    };

    const diff = execSync(
        `git difftool ${baseRef} -y -x "diff -C0" ${filename}`,
        { encoding: 'utf-8' },
    );

    // we skip the first section since that only contains the filename
    const sections = diff.split('***************').slice(1);

    const afterLineRegex = /^--- (\d+)(,(\d+))? ----$/;

    for (const section of sections) {
        core.info(`section = ${section}`);
        const lines = section.split('\n');
        const afterSeparatorIndex = lines.findIndex(line => afterLineRegex.test(line));
        core.info(`afterSeparatorIndex = ${afterSeparatorIndex}`);
        const separator = lines[afterSeparatorIndex];
        core.info(`separator = ${separator}`);
        const match = separator.match(afterLineRegex);
        // @ts-expect-error: we know that this group exists
        let index: number = match[1];
    
        const afterLines = lines.slice(afterSeparatorIndex);
        for (const line of afterLines) {
            if (line.startsWith('+ ')) {
                changes.added.push(index++);
            }
            if (line.startsWith('! ')) {
                changes.modified.push(index++);
            }
        }
    }

    return changes;
};
