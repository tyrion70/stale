import * as core from '@actions/core';
import * as github from '@actions/github';
import { Octokit } from '@octokit/rest';

type Issue = Octokit.IssuesListForRepoResponseItem;
type IssueLabel = Octokit.IssuesListForRepoResponseItemLabelsItem;
type IssueList = Octokit.Response<Octokit.IssuesListForRepoResponse>;

export interface IssueProcessorOptions {
    repoToken: string;
    staleIssueMessage: string;
    stalePrMessage: string;
    daysBeforeStale: number;
    daysBeforeClose: number;
    staleIssueLabel: string;
    exemptIssueLabel: string;
    stalePrLabel: string;
    exemptPrLabel: string;
    onlyLabels: string;
    operationsPerRun: number;
    debugOnly: boolean;
  }

/***
 * Handle processing of issues for staleness/closure.
 */
export class IssueProcessor {
    readonly client: github.GitHub;
    readonly options: IssueProcessorOptions;
    private operationsLeft: number = 0;

    constructor(options: IssueProcessorOptions) {
        this.options = options;
        this.client = new github.GitHub(options.repoToken);
    }

    public async processIssues(page: number = 1): Promise<number> {
      if (this.options.debugOnly) {
        core.warning('Executing in debug mode. Debug output will be written but no issues will be processed.');
      }

      if (this.operationsLeft <= 0) {
        core.warning('Reached max number of operations to process. Exiting.');
        return 0;
      }

      // get the next batch of issues
      const issues: IssueList = await this.getIssues(page);

      if (issues.data.length <= 0) {
          core.debug('No more issues found to process. Exiting.');
          return this.operationsLeft;
      }

      for (const issue of issues.data.values()) {
          const isPr: boolean = !!issue.pull_request;

          core.debug(`Found issue: issue #${issue.number} - ${issue.title} last updated ${issue.updated_at} (is pr? ${isPr})`);

          // calculate string based messages for this issue
          const staleMessage: string = isPr ? this.options.stalePrMessage : this.options.staleIssueMessage;
          const staleLabel: string = isPr ? this.options.stalePrLabel : this.options.staleIssueLabel;
          const exemptLabel: string = isPr ? this.options.exemptPrLabel : this.options.exemptIssueLabel;
          const issueType: string = isPr ? 'pr' : 'issue';

          if (!staleMessage) {
              core.debug(`Skipping ${issueType} due to empty stale message`);
              continue;
          }

          if (exemptLabel && IssueProcessor.isLabeled(issue, exemptLabel)) {
              core.debug(`Skipping ${issueType} because it has an exempt label`);
              continue; // don't process exempt issues
          }

          if (!IssueProcessor.isLabeled(issue, staleLabel)) {
              core.debug(`Found a stale ${issueType}`);
              if (this.options.daysBeforeClose >= 0 &&
                  IssueProcessor.wasLastUpdatedBefore(issue, this.options.daysBeforeClose))
              {
                  core.debug(`Closing ${issueType} because it was last updated on ${issue.updated_at}`)
                  await this.closeIssue(issue);
                  this.operationsLeft -= 1;
              } else {
                  core.debug(`Ignoring stale ${issueType} because it was updated recenlty`);
              }
          } else if (IssueProcessor.wasLastUpdatedBefore(issue, this.options.daysBeforeStale)) {
              core.debug(`Marking ${issueType} stale because it was last updated on ${issue.updated_at}`)
              await this.markStale(
                  issue,
                  staleMessage,
                  staleLabel
              );
              this.operationsLeft -= 2;
          }
      }

      // do the next batch
      return await this.processIssues(page + 1);
    }

    // grab issues from github in baches of 100
    private async getIssues(page: number): Promise<IssueList> {
      return this.client.issues.listForRepo({
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          state: 'open',
          labels: this.options.onlyLabels,
          per_page: 100,
          page
        });
  }

  // Mark an issue as stale with a comment and a label
  private async markStale(
      issue: Issue,
      staleMessage: string,
      staleLabel: string
    ): Promise<void> {
      core.debug(`Marking issue #${issue.number} - ${issue.title} as stale`);

      if (this.options.debugOnly) {
          return;
      }

      await this.client.issues.createComment({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: issue.number,
        body: staleMessage
      });

      await this.client.issues.addLabels({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: issue.number,
        labels: [staleLabel]
      });
    }

    /// Close an issue based on staleness
    private async closeIssue(
      issue: Issue
    ): Promise<void> {
      core.debug(`Closing issue #${issue.number} - ${issue.title} for being stale`);

      if (this.options.debugOnly) {
          return;
      }

      await this.client.issues.update({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: issue.number,
        state: 'closed'
      });
    }

    private static isLabeled(issue: Issue, label: string): boolean {
      const labelComparer: (l: IssueLabel) => boolean = l =>
        label.localeCompare(l.name, undefined, {sensitivity: 'accent'}) === 0;
      return issue.labels.filter(labelComparer).length > 0;
    }

    private static wasLastUpdatedBefore(issue: Issue, num_days: number): boolean {
      const daysInMillis = 1000 * 60 * 60 * 24 * num_days;
      const millisSinceLastUpdated =
        new Date().getTime() - new Date(issue.updated_at).getTime();
      return millisSinceLastUpdated >= daysInMillis;
    }
}