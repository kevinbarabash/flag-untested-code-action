import type { CoverageReport } from './coverage-report';

type DeltaReport = Record<
    string,
    {
        percent: number;
        coveredStatements: number;
        uncoveredStatements: number;
    }
>;

const getCoveredStatmentCount = (
    statements: Record<number, number>,
): number => {
    return Object.values(statements).filter((count) => count > 0).length;
};

export const compareReports = (
    baseReport: CoverageReport,
    headReport: CoverageReport,
): DeltaReport => {
    const report: DeltaReport = {};

    for (const filename in baseReport) {
        if (filename in headReport) {
            const baseFileCoverage = baseReport[filename];
            const headFileCoverage = headReport[filename];

            const baseCoveredStatementCount = getCoveredStatmentCount(
                baseFileCoverage.s,
            );
            const baseStatementCount = Object.keys(baseFileCoverage.s).length;
            const headCoveredStatementCount = getCoveredStatmentCount(
                headFileCoverage.s,
            );
            const headStatementCount = Object.keys(headFileCoverage.s).length;

            const basePercent = baseCoveredStatementCount / baseStatementCount;
            const headPercent = headCoveredStatementCount / headStatementCount;

            const baseUncoveredStatementCount =
                baseStatementCount - baseCoveredStatementCount;
            const headUncoveredStatementCount =
                headStatementCount - headCoveredStatementCount;

            report[filename] = {
                percent: headPercent - basePercent,
                coveredStatements:
                    headCoveredStatementCount - baseCoveredStatementCount,
                uncoveredStatements:
                    headUncoveredStatementCount - baseUncoveredStatementCount,
            };
        }
    }

    return report;
};
