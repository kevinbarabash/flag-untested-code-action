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
    const jsImplFiles = jsFiles.filter(file => !nonImplRegex.test(file));
    const jsTestFiles: string[] = jsImplFiles.flatMap(file => {
        const dirname = path.dirname(file);
        const basename = path.basename(file).replace(/\.jsx?$/, "");

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

    // TODO: exclude test files from this
    console.log('determing added/changed lines');
    for (const file of jsFiles) {
        const changes = getFileChanges(file, baseRef);
        core.info(`changes for ${file}`);
        core.info(JSON.stringify(changes, null, 4));
        core.info(`uncovered lines for ${file}`);
        const lines: number[] = uncoveredLines[file];
        core.info(lines.join(', '));

        lines.forEach((line: number) => {
            core.info(`changes.added.includes(line) ||
            changes.modified.includes(line) = ${
                changes.added.includes(line) || changes.modified.includes(line)
            }`);
            if (
                changes.added.includes(line) ||
                changes.modified.includes(line)
            ) {
                console.log(`reporting missing test for for line ${line}`);
                messages.push({
                    path: path.relative(current, file),
                    // TODO: reuse location data from the coverage report
                    start: { line, column: 1 },
                    end: { line, column: 1 },
                    annotationLevel: 'failure',
                    message: 'This line was added/modified but has no test',
                });
            }
        });
    }

    await sendReport(`Flag Untested Code`, messages);
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
