'use strict';

var path = require('path');
var child_process = require('child_process');
var fs = require('fs');
var chalk = require('chalk');
var cliHighlight = require('cli-highlight');
var minimatch = require('minimatch');
var util = require('util');
var core = require('@actions/core');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var path__default = /*#__PURE__*/_interopDefaultLegacy(path);
var fs__default = /*#__PURE__*/_interopDefaultLegacy(fs);
var chalk__default = /*#__PURE__*/_interopDefaultLegacy(chalk);
var minimatch__default = /*#__PURE__*/_interopDefaultLegacy(minimatch);
var core__default = /*#__PURE__*/_interopDefaultLegacy(core);

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
/**
 * Report out these error messages locally, by printing to stderr.
 */
const localReport = async (title, messages) => {
    console.log();
    console.log(chalk__default["default"].yellow(`[[ ${title} ]]`));
    console.log();
    const fileCache = {};
    const getFile = (filePath) => {
        if (!fileCache[filePath]) {
            const ext = path__default["default"].extname(filePath).slice(1);
            fileCache[filePath] = cliHighlight.highlight(fs__default["default"].readFileSync(filePath, 'utf8'), {
                language: ext,
                ignoreIllegals: true,
            }).split('\n');
        }
        return fileCache[filePath];
    };
    const byFile = {};
    messages.forEach((message) => {
        const lines = getFile(message.path);
        const lineStart = Math.max(message.start.line - 3, 0);
        const indexStart = lineStart + 1;
        const context = lines.slice(lineStart, message.end.line + 2);
        if (!byFile[message.path]) {
            byFile[message.path] = 1;
        }
        else {
            byFile[message.path] += 1;
        }
        console.error(':error:', chalk__default["default"].cyan(`${message.path}:${message.start.line}:${message.start.column}`));
        console.error(message.message);
        console.error('\n' +
            context
                .map((line, i) => `${chalk__default["default"].dim(indexStart + i + ':')}${indexStart + i >= message.start.line &&
                indexStart + i <= message.end.line
                ? chalk__default["default"].red('>')
                : ' '} ${line}`)
                .join('\n') +
            '\n');
    });
    const files = Object.keys(byFile);
    if (files.length > 1) {
        console.error(chalk__default["default"].yellow(`Issues by file`));
        console.error();
        for (const file of files) {
            console.error(`${byFile[file]} in ${chalk__default["default"].cyan(file)}`);
        }
    }
    console.error(chalk__default["default"].yellow(`${messages.length} total issues for ${title}`));
};
const removeWorkspace = (path) => {
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
const githubReport = async (title, token, messages) => {
    /* flow-uncovered-block */
    const { GitHub, context } = require('@actions/github');
    const { owner, repo } /*: {owner: string, repo: string}*/ = context.repo;
    const client = new GitHub(token, {});
    const headSha = context.payload.pull_request.head.sha;
    const check = await client.checks.create({
        owner,
        repo,
        started_at: new Date(),
        name: title,
        head_sha: headSha,
    });
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
    /* end flow-uncovered-block */
    const annotations = messages.map((message) => ({
        path: removeWorkspace(message.path),
        start_line: message.start.line,
        end_line: message.end.line,
        annotation_level: message.annotationLevel,
        message: message.message,
    }));
    let errorCount = 0;
    let warningCount = 0;
    messages.forEach((message) => {
        if (message.annotationLevel === 'failure') {
            errorCount += 1;
        }
        else {
            warningCount += 1;
        }
    });
    // The github checks api has a limit of 50 annotations per call
    // (https://developer.github.com/v3/checks/runs/#output-object)
    while (annotations.length > 0) {
        // take the first 50, removing them from the list
        const subset = annotations.splice(0, 50);
        /* flow-uncovered-block */
        await client.checks.update({
            owner,
            repo,
            check_run_id: check.data.id,
            completed_at: new Date(),
            status: 'completed',
            conclusion: errorCount > 0 ? 'failure' : 'success',
            output: {
                title: title,
                summary: `${errorCount} error(s), ${warningCount} warning(s) found`,
                annotations: subset,
            },
        });
        /* end flow-uncovered-block */
    }
};
const makeReport = (title, messages) => {
    if (GITHUB_TOKEN) {
        return githubReport(title, GITHUB_TOKEN, messages);
    }
    else {
        return localReport(title, messages);
    }
};

const execProm = util.promisify(child_process.exec);
function isNotNull(arg) {
    return arg !== null;
}
// ok
const getIgnoredPatterns = (fileContents) => {
    return fileContents
        .split('\n')
        .map(line => {
        if (line.startsWith('#')) {
            return null;
        }
        if (line.startsWith('"')) {
            throw new Error('Quoted patterns not yet supported, sorry');
        }
        if (!line.trim()) {
            return null;
        }
        const [pattern, ...attributes] = line.trim().split(' ');
        if (attributes.includes('binary') || attributes.includes('linguist-generated=true')) {
            return pattern;
        }
        return null;
    })
        .filter(isNotNull);
};
const ignoredPatternsByDirectory = {};
const isFileIgnored = (workingDirectory, file) => {
    // If it's outside of the "working directory", we ignore it
    if (!file.startsWith(workingDirectory)) {
        return true;
    }
    let dir = path__default["default"].dirname(file);
    let name = path__default["default"].basename(file);
    while (dir.startsWith(workingDirectory)) {
        if (!ignoredPatternsByDirectory[dir]) {
            const attributes = path__default["default"].join(dir, '.gitattributes');
            if (fs__default["default"].existsSync(attributes)) {
                ignoredPatternsByDirectory[dir] = getIgnoredPatterns(fs__default["default"].readFileSync(attributes, 'utf8'));
            }
            else {
                ignoredPatternsByDirectory[dir] = [];
            }
        }
        for (const pattern of ignoredPatternsByDirectory[dir]) {
            if (minimatch__default["default"](name, pattern)) {
                return true;
            }
        }
        name = path__default["default"].join(path__default["default"].basename(dir), name);
        dir = path__default["default"].dirname(dir);
    }
    return false;
};
/**
 * This lists the files that have changed when compared to `base` (a git ref),
 * limited to the files that are a descendent of `cwd`.
 * It also respects '.gitattributes', filtering out files that have been marked
 * as "binary" or "linguist-generated=true".
 */
const gitChangedFiles = async (base, cwd) => {
    cwd = path__default["default"].resolve(cwd);
    // Github actions jobs can run the following steps to get a fully accurate
    // changed files list. Otherwise, we fallback to a simple diff between the
    // current and base branch, which might give false positives if the base
    // is ahead of the current branch.
    //
    //   - name: Get All Changed Files
    //     uses: jaredly/get-changed-files@absolute
    //     id: changed
    //     with:
    //       format: 'json'
    //       absolute: true
    //
    //   - uses: allenevans/set-env@v2.0.0
    //     with:
    //       ALL_CHANGED_FILES: '${{ steps.changed.outputs.added_modified }}'
    //
    if (process.env.ALL_CHANGED_FILES) {
        const files = JSON.parse(process.env.ALL_CHANGED_FILES);
        return files.filter(path => !isFileIgnored(cwd, path));
    }
    const { stdout } = await execProm(`git diff --name-only ${base} --relative`, {
        cwd,
        encoding: 'utf8',
    });
    return (stdout
        .split('\n')
        .filter(isNotNull)
        .map((name) => path__default["default"].join(cwd, name))
        // Filter out paths that were deleted
        .filter((path) => fs__default["default"].existsSync(path))
        .filter((path) => !isFileIgnored(cwd, path)));
};

/**
 * This is used to determine what the "base" branch for the current work is.
 *
 * - If the `GITHUB_BASE_REF` env variable is present, then we're running
 *   under Github Actions, and we can just use that. If this is being run
 *   locally, then it's a bit more tricky to determine the "base" for this
 *   branch.
 * - If this branch hasn't yet been pushed to github (e.g. the "upstream" is
 *   something local), then use the upstream.
 * - Otherwise, go back through the commits until we find a commit that is part
 *   of another branch, that's either master, develop, or a feature/ branch.
 *   TODO(jared): Consider using the github pull-request API (if we're online)
 *   to determine the base branch.
 */
const { execSync, spawnSync } = require('child_process');
// NOTE: The final `--` tells git that `ref` is a branch name, and *not* a file or
// directory name. Without it, git gets confused when there's a branch with the
// same name as a directory.
const checkRef = (ref) => spawnSync('git', ['rev-parse', ref, '--']).status === 0;
const validateBaseRef = (baseRef) => {
    // It's locally accessible!
    if (checkRef(baseRef)) {
        return baseRef;
    }
    // If it's not locally accessible, then it's probably a remote branch
    const remote = `refs/remotes/origin/${baseRef}`;
    if (checkRef(remote)) {
        return remote;
    }
    // Otherwise return null - no valid ref provided
    return null;
};
const getBaseRef = (head = 'HEAD') => {
    const { GITHUB_BASE_REF } = process.env;
    if (GITHUB_BASE_REF) {
        return validateBaseRef(GITHUB_BASE_REF);
    }
    else {
        let upstream = execSync(`git rev-parse --abbrev-ref '${head}@{upstream}'`, {
            encoding: 'utf8',
        });
        upstream = upstream.trim();
        // if upstream is local and not empty, use that.
        if (upstream && !upstream.trim().startsWith('origin/')) {
            return `refs/heads/${upstream}`;
        }
        let headRef = execSync(`git rev-parse --abbrev-ref ${head}`, {
            encoding: 'utf8',
        });
        headRef = headRef.trim();
        for (let i = 1; i < 100; i++) {
            try {
                const stdout = execSync(`git branch --contains ${head}~${i} --format='%(refname)'`, { encoding: 'utf8' });
                let lines = stdout.split('\n').filter(Boolean);
                lines = lines.filter((line) => line !== `refs/heads/${headRef}`);
                // Note (Lilli): When running our actions locally, we want to be a little more
                // aggressive in choosing a baseRef, going back to a shared commit on only `develop`,
                // `master`, feature or release branches, so that we can cover more commits. In case,
                // say, I create a bunch of experimental, first-attempt, throw-away branches that
                // share commits higher in my stack...
                for (const line of lines) {
                    if (line === 'refs/heads/develop' ||
                        line === 'refs/heads/master' ||
                        line.startsWith('refs/heads/feature/') ||
                        line.startsWith('refs/heads/release/')) {
                        return line;
                    }
                }
            }
            catch (_a) {
                // Ran out of history, probably
                return null;
            }
        }
        // We couldn't find it
        return null;
    }
};

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
const runJest = (jestBin, jestOpts, spawnOpts) => {
    return new Promise((resolve, reject) => {
        core__default["default"].info(`running ${jestBin} ${jestOpts.join(' ')}`);
        const jest = child_process.spawn(jestBin, jestOpts, spawnOpts);
        jest.stdout.on('data', (data) => {
            core__default["default"].info(data.toString());
        });
        jest.stderr.on('data', (data) => {
            // jest uses stderr for all its output unfortunately
            // https://github.com/facebook/jest/issues/5064
            core__default["default"].info(data.toString());
        });
        jest.on('close', (code) => {
            // Jest will exit with a non-zero exit code if any test fails.
            // This is normal so we don't bother logging error code.
            resolve();
        });
    });
};
const parseList = (text) => {
    if (!text || !text.length) {
        return [];
    }
    return (text
        .split(',')
        // Trim intervening whitespace
        .map((item) => item.trim()));
};
async function run() {
    const jestBin = process.env['INPUT_JEST-BIN'];
    const workingDirectory = process.env['INPUT_CUSTOM-WORKING-DIRECTORY'] || '.';
    const subtitle = process.env['INPUT_CHECK-RUN-SUBTITLE'];
    const findRelatedTests = process.env['INPUT_FIND-RELATED-TESTS'];
    const runAllIfChanged = parseList(process.env['INPUT_RUN-ALL-IF-CHANGED']);
    if (!jestBin) {
        core__default["default"].info(`You need to have jest installed, and pass in the the jest binary via the variable 'jest-bin'.`);
        process.exit(1);
        return;
    }
    const baseRef = getBaseRef();
    if (!baseRef) {
        core__default["default"].info(`No base ref given`);
        process.exit(1);
        return;
    }
    const current = path__default["default"].resolve(workingDirectory);
    const files = await gitChangedFiles(baseRef, workingDirectory);
    const relativeFiles /*: Array<string> */ = files.map((absPath) => path__default["default"].relative(current, absPath));
    const shouldRunAll = runAllIfChanged.some((needle) => 
    // If it ends with a `/`, it's a directory, and we flag all descendents.
    needle.endsWith('/')
        ? relativeFiles.some((file) => file.startsWith(needle))
        : relativeFiles.some((file) => file === needle));
    const validExt = ['.js', '.jsx', '.mjs', '.ts', '.tsx'];
    const jsFiles = files.filter((file) => validExt.includes(path__default["default"].extname(file)));
    if (!jsFiles.length && !shouldRunAll) {
        core__default["default"].info('No JavaScript files changed');
        return;
    }
    const jestOpts = [
        '--json',
        '--testLocationInResults',
        '--passWithNoTests',
    ];
    // If we only want related tests, then we explicitly specify that and
    // include all of the files that are to be run.
    if (findRelatedTests && !shouldRunAll) {
        jestOpts.push('--findRelatedTests', ...jsFiles);
    }
    try {
        await core__default["default"].group('Running jest', async () => {
            await runJest(jestBin, jestOpts, { cwd: workingDirectory });
        });
    }
    catch (err) {
        core__default["default"].error('An error occurred trying to run jest');
        // @ts-expect-error: err is typed as mixed
        core__default["default"].error(err);
        process.exit(1);
    }
    core__default["default"].info('Parsing json output from jest');
    const data = {
        testResults: [],
        success: false,
    };
    const annotations = [];
    for (const testResult of data.testResults) {
        if (testResult.status !== 'failed') {
            continue;
        }
        let hadLocation = false;
        const path = testResult.name;
        for (const assertionResult of testResult.assertionResults) {
            if (assertionResult.status === 'failed' &&
                assertionResult.location) {
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
    await makeReport(`Jest${subtitle ? ' - ' + subtitle : ''}`, annotations);
}
run().catch((err) => {
    console.error(err);
    process.exit(1);
});
