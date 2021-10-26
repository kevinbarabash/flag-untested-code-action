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

import path from 'path';
import { spawn } from 'child_process';
import sendReport from './utils/send-report';
import gitChangedFiles from './utils/git-changed-files';
import getBaseRef from './utils/get-base-ref';
import * as core from '@actions/core';

import type { Message } from './utils/send-report';

const parseWithVerboseError = (text: string) => {
    try {
        return JSON.parse(text);
    } catch (err) {
        console.error('>> ❌ Invalid Json! ❌ <<');
        console.error(
            'Jest probably had an error, or something is misconfigured',
        );
        console.error(text);
        throw err;
    }
};

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

const parseList = (text?: string): string[] => {
    if (!text || !text.length) {
        return [];
    }
    return (
        text
            .split(',')
            // Trim intervening whitespace
            .map((item) => item.trim())
    );
};

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
    const relativeFiles: string[] = files.map((absPath) =>
        path.relative(current, absPath),
    );

    const validExt = ['.js', '.jsx', '.mjs', '.ts', '.tsx'];
    const jsFiles = files.filter((file) =>
        validExt.includes(path.extname(file)),
    );
    if (!jsFiles.length) {
        core.info('No JavaScript files changed');
        return;
    }

    core.info('changed files: \n' + jsFiles.join('\n'));
    // TODO: find related test files using relativeFiles

    const jestOpts = ['--coverage'];

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

    const data: {
        testResults: {
            name: string;
            assertionResults: {
                status: string;
                location: { line: number; column: number };
                failureMessages: string[];
            }[];
            message: string;
            status: string;
        }[];
        success: boolean;
    } = {
        testResults: [],
        success: false,
    };

    if (data.success) {
        await sendReport('Jest', []);
        return;
    }

    const annotations: Message[] = [];
    for (const testResult of data.testResults) {
        if (testResult.status !== 'failed') {
            continue;
        }
        let hadLocation = false;
        const path = testResult.name;
        for (const assertionResult of testResult.assertionResults) {
            if (
                assertionResult.status === 'failed' &&
                assertionResult.location
            ) {
                hadLocation = true;
                annotations.push({
                    path,
                    start: assertionResult.location,
                    end: assertionResult.location,
                    annotationLevel: 'failure',
                    message: assertionResult.failureMessages.join('\n\n'),
                });
            }
        }
        // All test failures have no location data
        if (!hadLocation) {
            annotations.push({
                path,
                start: { line: 1, column: 0 },
                end: { line: 1, column: 0 },
                annotationLevel: 'failure',
                message: testResult.message,
            });
        }
    }
    await sendReport(`Flag Untested Code`, annotations);
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
