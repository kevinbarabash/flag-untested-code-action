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
                if (!(fileCoverage.path in output)) {
                    output[fileCoverage.path] = [];
                }
                // TODO: include all lines if there's a range
                output[fileCoverage.path].push(stmt.start.line);
            }
        }
    }

    return output;
};

