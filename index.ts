import * as core from "@actions/core";
import * as github from "@actions/github";

type WorkflowStatus = "w_success" | "w_failure" | "w_cancelled";

interface SlackText {
  type: string;
  text: string;
}

interface SlackBlock {
  type: string;
  text?: SlackText;
  elements?: SlackText[];
  fields?: SlackText[];
}

interface SlackMessage {
  text: string;
  blocks: SlackBlock[];
}

interface Step {
  name: string;
  number: number;
  conclusion: string | null;
}

interface Job {
  status: string;
  conclusion: string | null;
  html_url: string | null;
  name: string;
  started_at: string;
  completed_at: string | null;
  steps?: Step[];
}

const failedConclusions = ["failure", "timed_out"];

const escape = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const dateDiff = function (start: Date, end: Date): string {
  let delta = (end.getTime() - start.getTime()) / 1000;
  const days = Math.floor(delta / 86400);
  delta -= days * 86400;
  const hours = Math.floor(delta / 3600) % 24;
  delta -= hours * 3600;
  const minutes = Math.floor(delta / 60) % 60;
  delta -= minutes * 60;
  const seconds = Math.floor(delta % 60);
  const format = (v: number, unit: string, omitZero: boolean): string =>
    v <= 0 && omitZero ? "" : `${v}${unit}`;
  return (
    format(days, "d", true) +
    format(hours, "h", true) +
    format(minutes, "m", true) +
    format(seconds, "s", false)
  );
};

const statusIcon = function (s: WorkflowStatus): string {
  switch (s) {
    case "w_success":
      return ":white_check_mark:";
    case "w_failure":
      return ":no_entry:";
    case "w_cancelled":
      return ":warning:";
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
  }
};

const workflowStatus = function (jobs: Job[]): WorkflowStatus {
  const conclusions = jobs.map((j) => j.conclusion);
  if (conclusions.some((c) => failedConclusions.includes(c ?? ""))) {
    return "w_failure";
  }
  if (conclusions.includes("cancelled")) {
    return "w_cancelled";
  }
  return "w_success";
};

const failedJobText = function (job: Job): string {
  const jobUrl = job.html_url ?? "";
  const steps = (job.steps ?? [])
    .filter((s) => failedConclusions.includes(s.conclusion ?? ""))
    .map((s) => `<${jobUrl}#step:${s.number}:1|${s.name}>`);
  const duration = dateDiff(
    new Date(job.started_at),
    new Date(job.completed_at ?? "")
  );
  const name = `:exclamation: <${jobUrl}|*${job.name}*>`;
  if (steps.length > 0) {
    return `${name} › ${steps.join(", ")} (${duration})`;
  }
  return `${name} (${duration})`;
};

async function run(): Promise<void> {
  try {
    const token = core.getInput("token");
    const runId = parseInt(core.getInput("run-id"));
    const runNumber = core.getInput("run-number");
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    const wfRun = await octokit.rest.actions.getWorkflowRun({
      owner,
      repo,
      run_id: runId
    });

    const allJobs: Job[] = await octokit.paginate(
      octokit.rest.actions.listJobsForWorkflowRun,
      { owner, repo, run_id: runId, per_page: 100 }
    );
    const jobs = allJobs.filter(
      (j) => j.status === "completed" && j.conclusion !== "skipped"
    );

    const wfStatus = workflowStatus(jobs);
    const failedJobs = jobs
      .filter((j) => failedConclusions.includes(j.conclusion ?? ""))
      .map((j) => ({ type: "mrkdwn", text: failedJobText(j) }));

    const commit = github.context.sha.slice(0, 8);
    const branch = github.context.ref.replace("refs/heads/", "");
    const message = escape(
      wfRun.data.head_commit?.message.split("\n")[0] ?? ""
    );
    const repository = github.context.payload.repository;

    const blocks: SlackBlock[] = [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${repository?.full_name ?? ""}*` }
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
            text: `Commit: *<${repository?.html_url ?? ""}/commit/${
              github.context.sha
            }|${commit}>*`
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
      text: `[${repository?.full_name ?? ""}] ${statusLabel(wfStatus)}: ${
        github.context.workflow
      } run ${runNumber}`,
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
