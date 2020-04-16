"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const args = getAndValidateArgs();
            const client = new github.GitHub(args.repoToken);
            yield processIssues(client, args);
        }
        catch (error) {
            core.error(error);
            core.setFailed(error.message);
        }
    });
}
function processIssues(client, args, page = 1) {
    return __awaiter(this, void 0, void 0, function* () {
        const issues = yield client.issues.listForRepo({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            state: 'open',
            per_page: 100,
            page: page
        });
        core.debug(`1 Start processing, commitjson = ${args.commitjson}`);
        let commit = JSON.parse(args.commitjson);
        let commitdate = commit.author.date;
        core.debug(`2 Start processing, commitdate = ${commitdate}`);
        for (var issue of issues.data.values()) {
            core.debug(`PETER found issue: ${issue.title} last updated ${issue.updated_at}`);
            let isPr = !!issue.pull_request;
            if (!isPr)
                continue;
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
            }
            else if (needsrebase(issue, commitdate)) {
                core.debug(`check issue: ${issue.title} because it has label already`);
                yield markStale(client, issue, staleMessage, staleLabel);
            }
            else {
                core.debug(`nothing done for issue: ${issue.title}`);
            }
        }
        return yield processIssues(client, args, page + 1);
    });
}
function isLabeled(issue, label) {
    const labelComparer = l => label.localeCompare(l.name, undefined, { sensitivity: 'accent' }) === 0;
    return issue.labels.filter(labelComparer).length > 0;
}
function wasLastUpdatedBefore(issue, num_days) {
    const daysInMillis = 1000 * 60 * 60 * 24 * num_days;
    const millisSinceLastUpdated = new Date().getTime() - new Date(issue.updated_at).getTime();
    return millisSinceLastUpdated >= daysInMillis;
}
function needsrebase(issue, commitdate) {
    core.debug(`commitdate ${commitdate}`);
    core.debug(`issue.updated_at ${issue.updated_at}`);
    const issueTimeInMillis = new Date(issue.updated_at).getTime();
    const commitTimeInMillis = new Date(commitdate).getTime();
    core.debug(`issueTimeInMillis ${issueTimeInMillis}`);
    core.debug(`commitTimeInMillis ${commitTimeInMillis}`);
    return new Date(issue.updated_at).getTime() < new Date(commitdate).getTime();
}
function markStale(client, issue, staleMessage, staleLabel) {
    return __awaiter(this, void 0, void 0, function* () {
        core.debug(`marking issue${issue.title} as stale`);
        yield client.issues.createComment({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: issue.number,
            body: staleMessage
        });
        yield client.issues.addLabels({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: issue.number,
            labels: [staleLabel]
        });
        return 2; // operations performed
    });
}
function closeIssue(client, issue) {
    return __awaiter(this, void 0, void 0, function* () {
        core.debug(`closing issue ${issue.title} for being stale`);
        yield client.issues.update({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: issue.number,
            state: 'closed'
        });
        return 1; // operations performed
    });
}
function getAndValidateArgs() {
    const args = {
        repoToken: core.getInput('repo-token', { required: true }),
        stalePrMessage: core.getInput('stale-pr-message'),
        stalePrLabel: core.getInput('stale-pr-label', { required: true }),
        commitjson: core.getInput('commitjson')
    };
    return args;
}
run();
