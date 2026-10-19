/**
 * The browser suite's reporter in CI: each test's name and how it ended, then
 * the totals. Nothing else.
 *
 * The suite reads production, real customers' calls, and this repository's
 * Actions logs are public, as the repository is. The usual reporters print a
 * failure in full: `list` prints an assertion's Expected and Received, and
 * `github` turns each failure into an annotation on the repository. Here the
 * check that matters most compares a quote with the segment it points at, so
 * its Received *is* a customer's sentence, and Playwright's own call log
 * quotes the elements it waited for. So no error message is printed, whatever
 * it says, and nothing a spec writes to the console. A failure is read by
 * running `pnpm e2e` on a machine of ours, where `list` and the trace keep
 * every detail (playwright.config.ts).
 *
 * Besides a name, a failure gets one thing: the line of the spec it failed
 * at. That is our code, not the page, and it says which check broke.
 */
import { dirname, isAbsolute, relative } from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestError, TestResult } from '@playwright/test/reporter';

const MARK: Record<TestResult['status'], string> = {
  passed: '  ok  ',
  failed: ' FAIL ',
  timedOut: ' TIME ',
  skipped: ' skip ',
  interrupted: ' STOP ',
};

export default class QuietReporter implements Reporter {
  private root = process.cwd();
  private specs: readonly string[] = [];
  private suite: Suite | undefined;

  onBegin(config: FullConfig, suite: Suite): void {
    this.root = config.configFile ? dirname(config.configFile) : process.cwd();
    this.specs = config.projects.map((project) => project.testDir);
    this.suite = suite;
    console.log(`${suite.allTests().length} test(s). A failure is named here; a local \`pnpm e2e\` says why.\n`);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // The path below the project: file, describe blocks, title. Titles are
    // written in the specs, never read off a page.
    const name = test.titlePath().slice(2).join(' › ');
    const retry = result.retry > 0 ? ` (retry ${result.retry})` : '';
    console.log(`${MARK[result.status]} ${name}${retry}${this.where(result.errors)}`);
  }

  // What a spec prints is about the page, so none of it is passed on.
  onStdOut(): void {}
  onStdErr(): void {}

  onError(error: TestError): void {
    console.log(` FAIL  outside any test${this.where([error])}`);
  }

  onEnd(result: FullResult): void {
    const tests = this.suite?.allTests() ?? [];
    const count = (outcome: ReturnType<TestCase['outcome']>): number =>
      tests.filter((test) => test.outcome() === outcome).length;
    console.log(
      `\n${count('expected')} passed, ${count('unexpected')} failed, ${count('flaky')} flaky, ${count('skipped')} skipped: ${result.status}.`,
    );
  }

  /**
   * True, so Playwright adds no reporter of its own: when no reporter prints,
   * it adds the dot reporter in CI, which prints every failure in full.
   */
  printsToStdio(): boolean {
    return true;
  }

  /** Where in the specs it failed: a file and a line, never the message. */
  private where(errors: readonly TestError[]): string {
    for (const error of errors) {
      const location = error.location;
      if (!location) continue;
      // Only a spec of ours: an error raised inside a library points there.
      const inSpecs = this.specs.some((dir) => {
        const path = relative(dir, location.file);
        return path !== '' && !path.startsWith('..') && !isAbsolute(path);
      });
      if (inSpecs) return `  (at ${relative(this.root, location.file).replaceAll('\\', '/')}:${location.line})`;
    }
    return '';
  }
}
