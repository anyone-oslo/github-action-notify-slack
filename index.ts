import * as core from "@actions/core";
import * as github from "@actions/github";

type WorkflowStatus = "w_success" | "w_failure" | "w_cancelled";

interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
  };
  elements?: Array<{ type: string; text: string }>;
  fields?: Array<{ type: string; text: string }>;
}

interface SlackMessage {
  text: string;
  blocks: SlackBlock[];
}

interface Job {
  status: string;
  conclusion: string | null;
  html_url: string;
  name: string;
  started_at: string;
  completed_at: string | null;
}

interface JobsResponse {
  data: {
    jobs: Job[];
  };
}

const dateDiff = function (start: Date, end: Date): string {
  const duration = end.getTime() - start.getTime();
  // format the duration
  let delta = duration / 1000;
  const days = Math.floor(delta / 86400);
  delta -= days * 86400;
  const hours = Math.floor(delta / 3600) % 24;
  delta -= hours * 3600;
  const minutes = Math.floor(delta / 60) % 60;
  delta -= minutes * 60;
  const seconds = Math.floor(delta % 60);
  const formatFunc = function (
    v: number,
    text: string,
    check: boolean
  ): string {
    if (v <= 0 && check) {
      return "";
    } else {
      return v + text;
    }
  };
  return (
    formatFunc(days, "d", true) +
    formatFunc(hours, "h", true) +
    formatFunc(minutes, "m", true) +
    formatFunc(seconds, "s", false)
  );
};

const statusIcon = function (s: string): string {
  switch (s) {
    case "w_success":
      return ":white_check_mark:";
    case "w_failure":
      return ":no_entry:";
    case "w_cancelled":
      return ":warning:";
    case "success":
      return "\u2713";
    case "failure":
      return ":exclamation:";
    default:
      return "\u20e0";
  }
};

const statusLabel = function (s: WorkflowStatus): string {
  switch (s) {
    case "w_success":
      return "Success";
    case "w_failure":
      return "Failure";
    case "w_cancelled":
      return "Cancelled";
    default:
      return "Unknown";
  }
};

async function run(): Promise<void> {
  try {
    // const slackWebhookUrl = core.getInput('slack-webhook-url');
    // console.log(`Webhook URL ${slackWebhookUrl}!`);

    // Get the JSON webhook payload for the event that triggered
    // the workflow
    // const payload = JSON.stringify(
    //   github.context.payload,
    //   undefined,
    //   2
    // );
    // console.log(`The event payload: ${payload}`);

    const token = core.getInput("token");
    const runId = core.getInput("run-id");
    const runNumber = core.getInput("run-number");
    const octokit = github.getOctokit(token);

    const wfRun = await octokit.rest.actions.getWorkflowRun({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      run_id: parseInt(runId)
    });

    const jobs = (await octokit.request(wfRun.data.jobs_url)) as JobsResponse;

    const commit = github.context.sha.substr(0, 8);
    let wfStatus: WorkflowStatus = "w_success";
    const branch = github.context.ref.split("/").reverse()[0];

    let pr = "";
    if (wfRun.data.pull_requests) {
      for (const p of wfRun.data.pull_requests) {
        pr += ",<" + p.url + "|#" + p.number + ">";
      }
      if (pr !== "") {
        pr = "for " + pr.substr(1);
      }
    }

    // build the message
    const failedJobs: Array<{ type: string; text: string }> = [];
    let wfSucceeded = true;
    let wfFailed = false;
    for (const j of jobs.data.jobs) {
      // ignore the current job running this script
      if (j.status !== "completed") {
        continue;
      }
      if (j.conclusion !== "success") {
        wfSucceeded = false;
      }
      if (j.conclusion === "failure") {
        wfFailed = true;
        failedJobs.push({
          type: "mrkdwn",
          text:
            statusIcon(j.conclusion ?? "") +
            " <" +
            j.html_url +
            "|*" +
            j.name +
            "*> (" +
            dateDiff(new Date(j.started_at), new Date(j.completed_at ?? "")) +
            ")"
        });
      }
    }
    if (wfSucceeded) {
      wfStatus = "w_success";
    } else if (wfFailed) {
      wfStatus = "w_failure";
    }

    const message = wfRun.data.head_commit?.message.split("\n")[0] ?? "";

    const blocks: SlackBlock[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${github.context.payload.repository?.full_name ?? ""}*`
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${statusIcon(wfStatus)} <${wfRun.data.html_url}|${
            wfRun.data.name
          } #${runNumber}>: *${message}*`
        }
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `Branch: *${branch}*` },
          {
            type: "mrkdwn",
            text: `Commit: *<${
              github.context.payload.repository?.url ?? ""
            }/commit/${github.context.sha}|${commit}>*`
          },
          {
            type: "mrkdwn",
            text: `*${jobs.data.jobs.length}* jobs`
          },
          {
            type: "mrkdwn",
            text:
              ":stopwatch: *" +
              dateDiff(
                new Date(wfRun.data.created_at),
                new Date(wfRun.data.updated_at)
              ) +
              "*"
          }
        ]
      }
    ];

    if (failedJobs.length > 0) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "*Failed tasks:*" }
      });
      blocks.push({ type: "divider" });
      blocks.push({ type: "section", fields: failedJobs });
    }

    const output: SlackMessage = {
      text: `[${
        github.context.payload.repository?.full_name ?? ""
      }] ${statusLabel(wfStatus)}: ${github.context.workflow} run ${runNumber}`,
      blocks: blocks
    };

    core.setOutput("message", output);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed(String(error));
    }
  }
}

void run();
