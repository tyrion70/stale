import * as core from '@actions/core';
import * as github from '@actions/github';
import * as Octokit from '@octokit/rest';

type Issue = Octokit.IssuesListForRepoResponseItem;
type IssueLabel = Octokit.IssuesListForRepoResponseItemLabelsItem;

type Args = {
  repoToken: string;
  stalePrMessage: string;
  stalePrLabel: string;
  commitjson: string;
};

async function run() {
  try {
    const args = getAndValidateArgs();

    const client = new github.GitHub(args.repoToken);
    await processIssues(client, args, 100);
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
}

async function processIssues(
  client: github.GitHub,
  args: Args,
  operationsLeft: number,
  page: number = 1
): Promise<number> {
  const issues = await client.issues.listForRepo({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    state: 'open',
    per_page: 100,
    page: page
  });

  operationsLeft -= 1;	

  if (issues.data.length === 0 || operationsLeft === 0) {	
    return operationsLeft;	
  }

  core.debug(`1 Start processing, commitjson = ${args.commitjson}`);
  let commit = JSON.parse(args.commitjson);
  let commitdate = commit.author.date;
  core.debug(`2 Start processing, commitdate = ${commitdate}`);

  for (var issue of issues.data.values()) {
    core.debug(
      `PETER found issue: ${issue.title} last updated ${issue.updated_at}`
    );
    let isPr = !!issue.pull_request;

    if (!isPr) continue;

    let staleMessage = args.stalePrMessage;
    if (!staleMessage) {
      core.debug(`skipping ${isPr ? 'pr' : 'issue'} due to empty message`);
      continue;
    }

    let staleLabel = args.stalePrLabel;

    if (isLabeled(issue, staleLabel)) {
      /*
      if (wasLastUpdatedBefore(issue, args.daysBeforeClose)) {
        core.debug(
          `closing issue: ${issue.title} because it has label already`
        );
      } else {
        core.debug(
          `skipping issue: ${issue.title} because it has label already`
        );
        continue;
      }
*/
      continue;
    } else if (needsrebase(issue, commitdate)) {
      core.debug(`check issue: ${issue.title} because it has label already`);
      operationsLeft -= await markStale(client, issue, staleMessage, staleLabel);
    } else {
      core.debug(`nothing done for issue: ${issue.title}`);
    }
    if (operationsLeft <= 0) {	
      core.warning(	
        `performed 100 operations, exiting to avoid rate limit`	
      );	
      return 0;	
    }	
  }
  return await processIssues(client, args, operationsLeft, page + 1);
}

function isLabeled(issue: Issue, label: string): boolean {
  const labelComparer: (l: IssueLabel) => boolean = l =>
    label.localeCompare(l.name, undefined, {sensitivity: 'accent'}) === 0;
  return issue.labels.filter(labelComparer).length > 0;
}

function wasLastUpdatedBefore(issue: Issue, num_days: number): boolean {
  const daysInMillis = 1000 * 60 * 60 * 24 * num_days;
  const millisSinceLastUpdated =
    new Date().getTime() - new Date(issue.updated_at).getTime();
  return millisSinceLastUpdated >= daysInMillis;
}

function needsrebase(issue: Issue, commitdate: string): boolean {
  core.debug(`commitdate ${commitdate}`);
  core.debug(`issue.updated_at ${issue.updated_at}`);
  const issueTimeInMillis = new Date(issue.updated_at).getTime();
  const commitTimeInMillis = new Date(commitdate).getTime();
  core.debug(`issueTimeInMillis ${issueTimeInMillis}`);
  core.debug(`commitTimeInMillis ${commitTimeInMillis}`);
  return new Date(issue.updated_at).getTime() < new Date(commitdate).getTime();
}
async function markStale(
  client: github.GitHub,
  issue: Issue,
  staleMessage: string,
  staleLabel: string
): Promise<number> {
  core.debug(`marking issue${issue.title} as stale`);

  await client.issues.createComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: issue.number,
    body: staleMessage
  });

  await client.issues.addLabels({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: issue.number,
    labels: [staleLabel]
  });

  return 2; // operations performed
}

async function closeIssue(
  client: github.GitHub,
  issue: Issue
): Promise<number> {
  core.debug(`closing issue ${issue.title} for being stale`);

  await client.issues.update({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: issue.number,
    state: 'closed'
  });

  return 1; // operations performed
}

function getAndValidateArgs(): Args {
  const args = {
    repoToken: core.getInput('repo-token', {required: true}),
    stalePrMessage: core.getInput('stale-pr-message'),
    stalePrLabel: core.getInput('stale-pr-label', {required: true}),
    commitjson: core.getInput('commitjson')
  };

  return args;
}

run();
