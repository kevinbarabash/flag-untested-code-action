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

import * as core from '@actions/core';

import sendReport from './utils/send-report';
import getBaseRef from './utils/get-base-ref';
import { main } from './main';

async function run() {
    const jestBin = core.getInput('jest-bin');
    const workingDirectory = core.getInput('custom-working-directory') || '.';
    const annotationLevel = (core.getInput('annotation-level') || 'warning') as
        | 'warning'
        | 'failure';

    const baseRef = getBaseRef();

    const {deltaReport, messages, summaryLines} = await main(
        jestBin,
        workingDirectory,
        annotationLevel,
        baseRef,
        core,
    );

    await sendReport(`Flag Untested Code`, messages, deltaReport);

    core.setOutput('report', summaryLines.join('\n'));
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
