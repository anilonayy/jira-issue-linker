const vscode = require("vscode");
const axios = require("axios");

function activate(context) {
  const cache = new Map();
  const CACHE_DURATION = 5 * 60 * 1000;
  
  const defaultResponse = {
    status: "Error retrieving status",
    developer: {},
    qa: {},
    completeDate: {},
  };

  vscode.window.showInformationMessage("Jira Comment Linker is active!");

  function getUserSettings() {
    const config = vscode.workspace.getConfiguration("jiraCommentLinker");

    const jiraBaseUrl = config.get("jiraBaseURL") || "";
    const jiraApiTokenBase64 = config.get("jiraToken") || "";
    const fields = config.get("jiraFields") || {};

    return { jiraBaseUrl, jiraApiTokenBase64, fields };
  }

  async function getTaskDetail(taskKey) {
    const { jiraBaseUrl, jiraApiTokenBase64, fields } = getUserSettings();
    
    const cachedData = cache.get(taskKey);
    const now = Date.now();
    
    for (const [key, value] of cache.entries()) {
      if (now - value.timestamp >= CACHE_DURATION) {
        cache.delete(key);
      }
    }

    
    if (cachedData && (now - cachedData.timestamp) < CACHE_DURATION) {
    console.log("Task retrieved from cache!", taskKey);
      return cachedData.data;
    }

    if (!jiraApiTokenBase64) {
      vscode.window.showErrorMessage("JIRA API Token (Base64) is not set!");
      return defaultResponse;
    }

    try {
      const response = await axios.get(`${jiraBaseUrl}/rest/api/3/issue/${taskKey}`, {
        headers: {
          Authorization: `Basic ${jiraApiTokenBase64}`,
          Accept: "application/json",
        },
      });

      const responseFields = response?.data?.fields ?? {};
      const data = {
        status: responseFields.status?.name ?? "Not available",
        developer: responseFields[fields.developer ?? ""] ?? {},
        qa: responseFields[fields.qa ?? ""] ?? {},
        completeDate: responseFields[fields.completeDate ?? ""] ?? {},
      };
      
      cache.set(taskKey, { data, timestamp: now });

      return data;
    } catch (error) {
      vscode.window.showErrorMessage(`JIRA API request failed: ${error.message}`);
      
      cache.set(taskKey, {data: defaultResponse, timestamp: now});
      
      return defaultResponse;
    }
  }

  const hoverProvider = {
    provideHover(document, position) {
      const range = document.getWordRangeAtPosition(position, /\b[A-Z]+-\d+\b/);
      if (!range) return;

      const taskKey = document.getText(range);

      return new Promise((resolve) => {
        getTaskDetail(taskKey).then(({ developer, status, qa, completeDate }) => {
          const popUpContext = [`**Status:** ${status}`];

          if (Object.keys(developer).length) {
            popUpContext.push(
            '**Developer**',
            `![Developer Avatar](${(developer?.avatarUrls ?? [])["16x16"]}) ${developer.displayName}`
            );
          }

          if (Object.keys(qa).length) {
            popUpContext.push(
             '**QA**',
            `![QA Avatar](${(qa?.avatarUrls ?? [])["16x16"]}) ${qa.displayName}`
            );
          }

          if (Object.keys(completeDate).length) {
            popUpContext.push('**Complete Date**', completeDate);
          }

          resolve(new vscode.Hover(popUpContext));
        });
      });
    },
  };

  const decorationType = vscode.window.createTextEditorDecorationType({
    textDecoration: "underline",
    cursor: "pointer"
  });

  function updateDecorations(editor) {
    const { jiraBaseUrl } = getUserSettings();
    if (!editor || !jiraBaseUrl) return;

    const text = editor.document.getText();
    const regex = /\b[A-Z]+-\d+\b/g;
    const decorations = [];

    let match;
    while ((match = regex.exec(text)) !== null) {
      const startPos = editor.document.positionAt(match.index);
      const endPos = editor.document.positionAt(match.index + match[0].length);
      const range = new vscode.Range(startPos, endPos);
      
      decorations.push({
        range,
        hoverMessage: `**Task:** [${match[0]}](${jiraBaseUrl}/browse/${match[0]})`,
        command: {
          command: "jiraCommentLinker.openTask",
          title: "Open JIRA Task",
          arguments: [`${jiraBaseUrl}/browse/${match[0]}`],
        },
      });
    }

    editor.setDecorations(decorationType, decorations);
  }
  

  function triggerDecorationsForCurrentEditor() {
    const editor = vscode.window.activeTextEditor;
    if (editor) updateDecorations(editor);
  }

  vscode.commands.registerCommand("jiraCommentLinker.openTask", (url) => {
  console.log("Opening URL ", url);
    vscode.env.openExternal(vscode.Uri.parse(url));
  });

  vscode.workspace.onDidOpenTextDocument((document) => {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document === document) {
      updateDecorations(editor);
    }
  }, null, context.subscriptions);

  vscode.workspace.onDidChangeTextDocument((event) => {
    const editor = vscode.window.activeTextEditor;
    if (editor && event.document === editor.document) {
      updateDecorations(editor);
    }
  }, null, context.subscriptions);

  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) updateDecorations(editor);
  }, null, context.subscriptions);

  ["javascript", "html", "css"].forEach((language) => {
    context.subscriptions.push(
      vscode.languages.registerHoverProvider({ scheme: "file", language }, hoverProvider)
    );
  });

  triggerDecorationsForCurrentEditor();
}

function deactivate() {
  console.log("JIRA Comment Linker is deactivated.");
}

module.exports = {
  activate,
  deactivate,
};
