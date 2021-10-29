type Range = {
    start: { line: number; column: number };
    end: { line: number; column: number };
};

type Statement = Range;

type Fn = {
    name: string;
    decl: Range;
    loc: Range;
    line: number;
};

type FileCoverage = {
    path: string;
    statementMap: Record<number, Statement>;
    fnMap: Record<number, Fn>;
    branchMap: {}; // TODO
    s: Record<number, number>; // <statement, coverage count>
    f: Record<number, number>; // <fn, coverage count>
    b: {}; // TODO:
    _coverageSchema: string;
    hash: string;
};

export type CoverageReport = Record<string, FileCoverage>; // key == filename

export const getUncoveredLines = (report: CoverageReport): Record<string, number[]> => {
    const output: Record<string, number[]> = {};
     
    for (const fileCoverage of Object.values(report)) {
        const lines: number[] = [];
        for (const [id, stmt] of Object.entries(fileCoverage.statementMap)) {
            // @ts-expect-error: TypeScript thinks `id` is `any` for some reason
            if (fileCoverage.s[id] === 0) {
                // NOTE(kevinb): for some reason when running tests inside of a
                // temp directory on MacOS jest prefixes the paths in the coverage
                // report with `/private/`.  This code strips off the `/private/`
                // prefix if it exists.
                const filepath = fileCoverage.path.startsWith('/private/var/')
                    ? fileCoverage.path.replace('/private/var/', '/var/')
                    : fileCoverage.path;

                // TODO: strip off the cwd from the filepath so that reports are
                // easier to work with.
                if (!(filepath in output)) {
                    output[filepath] = [];
                }
                // TODO: include all lines if there's a range
                // TODO: add a test case for this where a statement is multiple lines
                output[filepath].push(stmt.start.line);
            }
        }
    }

    return output;
};

