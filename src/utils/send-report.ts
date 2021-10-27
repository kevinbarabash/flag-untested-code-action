/**
 * The goal of this "action runner" is to allow running "locally"
 * or in a github action.
 *
 * Local running writes to stdout
 * Github running creates a github check.
 *
 * And we distinguish between the two by the presence or absence of
 * the GITHUB_TOKEN env variable.
 */

const { GITHUB_TOKEN, GITHUB_WORKSPACE } = process.env;

import * as core from '@actions/core';
import * as github from '@actions/github';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { highlight } from 'cli-highlight';

import type { DeltaReport } from '../delta-report';

export type Message = {
    message: string;
    startLine: number;
    endLine: number;
    annotationLevel: 'failure' | 'warning';
    path: string;
};

/**
 * Report out these error messages locally, by printing to stderr.
 */
const localReport = async (
    title: string,
    messages: Message[],
    deltaReport: DeltaReport,
) => {
    console.log();
    console.log(chalk.yellow(`[[ ${title} ]]`));
    console.log();
    const fileCache: Record<string, string[]> = {};
    const getFile = (filePath: string) => {
        if (!fileCache[filePath]) {
            const ext = path.extname(filePath).slice(1);
            fileCache[filePath] = highlight(fs.readFileSync(filePath, 'utf8'), {
                language: ext,
                ignoreIllegals: true,
            }).split('\n');
        }
        return fileCache[filePath];
    };
    const byFile: Record<string, number> = {};
    messages.forEach((message) => {
        const lines = getFile(message.path);
        const lineStart = Math.max(message.startLine - 3, 0);
        const indexStart = lineStart + 1;
        const context = lines.slice(lineStart, message.endLine + 2);
        if (!byFile[message.path]) {
            byFile[message.path] = 1;
        } else {
            byFile[message.path] += 1;
        }
        console.error(
            ':error:',
            chalk.cyan(`${message.path}:${message.startLine}`),
        );
        console.error(message.message);
        console.error(
            '\n' +
                context
                    .map(
                        (line, i) =>
                            `${chalk.dim(indexStart + i + ':')}${
                                indexStart + i >= message.startLine &&
                                indexStart + i <= message.endLine
                                    ? chalk.red('>')
                                    : ' '
                            } ${line}`,
                    )
                    .join('\n') +
                '\n',
        );
    });
    const files = Object.keys(byFile);
    if (files.length > 1) {
        console.error(chalk.yellow(`Issues by file`));
        console.error();
        for (const file of files) {
            console.error(`${byFile[file]} in ${chalk.cyan(file)}`);
        }
    }

    console.error(chalk.yellow(`${messages.length} total issues for ${title}`));
};

const removeWorkspace = (path: string) => {
    // To appease flow
    if (!GITHUB_WORKSPACE) {
        return path;
    }
    if (path.startsWith(GITHUB_WORKSPACE)) {
        return path.substring(GITHUB_WORKSPACE.length + 1);
    }
    return path;
};

/**
 * Report out these errors to github, by making a new "check" and uploading
 * the messages as annotations.
 */
const githubReport = async (
    title: string,
    token: string,
    messages: Message[],
    deltaReport: DeltaReport,
) => {
    const { owner, repo } = github.context.repo;
    const octokit = github.getOctokit(token);
    const client = octokit.rest;
    const headSha = github.context.payload.pull_request?.head.sha;
    const check = await client.checks.create({
        owner,
        repo,
        started_at: new Date(),
        name: title,
        head_sha: headSha,
    });
    core.info(`messages count = ${messages.length}`);

    if (!messages.length) {
        await client.checks.update({
            owner,
            repo,
            check_run_id: check.data.id,
            completed_at: new Date(),
            status: 'completed',
            conclusion: 'success',
            output: {
                title: title,
                summary: `All clear!`,
                annotations: [],
            },
        });
    }

    const annotations = messages.map((message) => ({
        path: removeWorkspace(message.path),
        start_line: message.startLine,
        end_line: message.endLine,
        annotation_level: message.annotationLevel,
        message: message.message,
    }));
    let errorCount = 0;
    let warningCount = 0;
    messages.forEach((message) => {
        if (message.annotationLevel === 'failure') {
            errorCount += 1;
        } else {
            warningCount += 1;
        }
    });

    const summaryLines = [
        `${errorCount} error(s), ${warningCount} warning(s) found`,
        `## Coverage deltas`,
        `|file|% change|lines covered|lines uncovered|`,
        `|-|-|-|-|`,
    ];

    for (const [file, delta] of Object.entries(deltaReport)) {
        const { percent, covered, uncovered } = delta;
        const relFile = path.relative(path.resolve('.'), file);
        summaryLines.push(
            `|${relFile}|${(percent * 100).toFixed(2)}|${covered}|${uncovered}|`,
        );
    }

    // The github checks api has a limit of 50 annotations per call
    // (https://developer.github.com/v3/checks/runs/#output-object)
    while (annotations.length > 0) {
        // take the first 50, removing them from the list
        const subset = annotations.splice(0, 50);
        await client.checks.update({
            owner,
            repo,
            check_run_id: check.data.id,
            completed_at: new Date(),
            status: 'completed',
            conclusion: errorCount > 0 ? 'failure' : 'success',
            output: {
                title: title,
                summary: summaryLines.join('\n'),
                annotations: subset,
            },
        });
    }
};

const makeReport = (
    title: string,
    messages: Message[],
    deltaReport: DeltaReport,
): Promise<void> => {
    if (GITHUB_TOKEN) {
        return githubReport(title, GITHUB_TOKEN, messages, deltaReport);
    } else {
        return localReport(title, messages, deltaReport);
    }
};

export default makeReport;
