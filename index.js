const core = require('@actions/core');
const github = require('@actions/github');

try {
  // const slackWebhookUrl = core.getInput('slack-webhook-url');
  // console.log(`Webhook URL ${slackWebhookUrl}!`);

  // Get the JSON webhook payload for the event that triggered the workflow
  // const payload = JSON.stringify(github.context.payload, undefined, 2);
  // console.log(`The event payload: ${payload}`);

  const token = core.getInput('token');
  const runId = core.getInput('run-id');
  const runNumber = core.getInput('run-number');
  const octokit = new github.GitHub(token);

  const dateDiff = function(start, end) {
    var duration = end - start;
    // format the duration
    var delta = duration / 1000;
    var days = Math.floor(delta / 86400);
    delta -= days * 86400;
    var hours = Math.floor(delta / 3600) % 24;
    delta -= hours * 3600;
    var minutes = Math.floor(delta / 60) % 60;
    delta -= minutes * 60;
    var seconds = Math.floor(delta % 60);
    var format_func = function(v, text, check) {
      if (v <= 0 && check) {
        return "";
      } else {
        return v + text;
      }
    };
    return format_func(days, "d", true) +
      format_func(hours, "h", true) +
      format_func(minutes, "m", true) +
      format_func(seconds, "s", false);
  };

  const statusIcon = function(s) {
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
      return "\u2717";
    default:
      return "\u20e0";
    }
  };

  const statusLabel = function(s) {
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

  octokit.actions.getWorkflowRun({
    owner: github.context.payload.repository.organization,
    repo: github.context.payload.repository.name,
    run_id: runId
  }).then((wfRun) => {
    octokit.request(wfRun.data.jobs_url).then((jobs) => {
      const commit = github.context.sha.substr(0, 6);
      let wfStatus = "w_cancelled";
      const branch = github.context.ref.split("/").reverse()[0];

      let pr = "";
      for (p of wfRun.data.pull_requests) {
        pr += ",<" + p.url + "|#" + p.number + ">";
      }
      if (pr != "") {
        pr = "for " + pr.substr(1);
      }

      // build the message
      let fields = [];
      var wfSucceeded = true;
      var wfFailed = false;
      for (j of jobs.data.jobs) {
        // ignore the current job running this script
        if (j.status != "completed") {
          continue;
        }
        if (j.conclusion != "success") {
          wfSucceeded = false;
        }
        if (j.conclusion == "failure") {
          wfFailed = true;
        }
        fields.push({
          type: "mrkdwn",
          text: statusIcon(j.conclusion) + " <" + j.html_url + "|*" + j.name + "*> (" + dateDiff(new Date(j.started_at), new Date(j.completed_at)) + ")"
        });
      }
      if (wfSucceeded) {
        wfStatus = "w_success";
      } else if (wfFailed) {
        wfStatus = "w_failure";
      }


      core.setOutput("message", {
        text: `[${github.context.payload.repository.full_name}] ${statusLabel(wfStatus)}: ${github.context.workflow} run ${runNumber}`,
        blocks: [
          { type: "section",
            text: { type: "mrkdwn",
                    text: `${statusIcon(wfStatus)} *${statusLabel(wfStatus)}*` }},
          { type: "section",
            text: { type: "mrkdwn",
                    text: `<${github.context.payload.repository.url}|*${github.context.payload.repository.full_name}*> - ` +
                    `${github.context.workflow} <` + wfRun.data.html_url +  `|#${runNumber}> completed in ` +
                    dateDiff(new Date(wfRun.data.created_at), new Date(wfRun.data.updated_at)) +
                    ` (${branch}@<${github.context.payload.repository.url}/commit/${github.context.sha}|${commit}>)`+
                    pr
                  }
          },
          { type: "divider" },
          { type: "section", fields: fields }
        ]});
    });
  });
} catch (error) {
  core.setFailed(error.message);
}
