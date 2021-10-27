/**
 * This action runs `jest` and reports any type errors it encounters.
 *
 * It expects the path to the `jest` binary to be provided as the first
 * argument, and it runs `jest` in the current working directory.
 *
 * It uses `send-report.js` to support both running locally (reporting to
 * stdout) and under Github Actions (adding annotations to files in the GitHub
 * UI).
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import * as core from '@actions/core';

import sendReport from './utils/send-report';
import gitChangedFiles from './utils/git-changed-files';
import getBaseRef from './utils/get-base-ref';
import { getUncoveredLines } from './coverage-report';
import { getFileChanges } from './file-changes';

import type { Message } from './utils/send-report';
import type { CoverageReport } from './coverage-report';

const runJest = (
    jestBin: string,
    jestOpts: string[],
    spawnOpts: any,
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

const LINE_ADDED = 'This line was added but is untested';
const LINES_ADDED = 'These lines were added but are untested';
const LINE_MODIFIED = 'This line was modified but is untested';
const LINES_MODIFIED = 'These lines were modified but are untested';

async function run() {
    const jestBin = process.env['INPUT_JEST-BIN'];
    const workingDirectory =
        process.env['INPUT_CUSTOM-WORKING-DIRECTORY'] || '.';

    if (!jestBin) {
        core.info(
            `You need to have jest installed, and pass in the the jest binary via the variable 'jest-bin'.`,
        );
        process.exit(1);
        return;
    }

    const baseRef = getBaseRef();
    if (!baseRef) {
        core.info(`No base ref given`);
        process.exit(1);
        return;
    }

    const current = path.resolve(workingDirectory);
    const files = await gitChangedFiles(baseRef, workingDirectory);

    const validExt = ['.js', '.jsx', '.mjs', '.ts', '.tsx'];
    const jsFiles = files.filter((file) =>
        validExt.includes(path.extname(file)),
    );
    if (!jsFiles.length) {
        core.info('No JavaScript files changed');
        return;
    }

    core.info('changed files: \n' + jsFiles.join('\n'));
    const nonImplRegex = /(_test|\.test|\.fixture|\.stories)\.jsx?$/;
    const jsImplFiles = jsFiles.filter((file) => !nonImplRegex.test(file));
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

    const jestOpts = ['--coverage', ...jsTestFiles];

    try {
        await core.group('Running jest', async () => {
            await runJest(jestBin, jestOpts, { cwd: workingDirectory });
        });
    } catch (err) {
        core.error('An error occurred trying to run jest');
        // @ts-expect-error: err is typed as mixed
        core.error(err);
        process.exit(1);
    }

    core.info('Parsing json output from jest');

    const reportPath = path.join(current, 'coverage/coverage-final.json');
    const report: CoverageReport = JSON.parse(
        fs.readFileSync(reportPath, 'utf-8'),
    );
    const uncoveredLines = getUncoveredLines(report);

    const messages: Message[] = [];
    const annotationLevel = (process.env['INPUT_ANNOTATION-LEVEL'] ||
        'warning') as 'warning' | 'failure';

    console.log('determing added/changed lines in implementation files');
    for (const file of jsImplFiles) {
        const changes = getFileChanges(file, baseRef);
        core.info(`changes for ${file}`);
        core.info(JSON.stringify(changes, null, 4));
        core.info(`uncovered lines for ${file}`);
        const lines: number[] = uncoveredLines[file];
        core.info(lines.join(', '));

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
                        path: path.relative(path.resolve('.'), file),
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
                        path: path.relative(path.resolve('.'), file),
                        startLine: line,
                        endLine: line,
                        annotationLevel,
                        message: LINE_MODIFIED,
                    });
                }
            }
        });

        messages.forEach(message => {
            if (message.endLine - message.startLine > 0) {
                if (message.message === LINE_ADDED) {
                    message.message = LINES_ADDED;
                } else if (message.message === LINE_MODIFIED) {
                    message.message = LINES_MODIFIED;
                }
            }
        })
    }

    await sendReport(`Flag Untested Code`, messages);
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
