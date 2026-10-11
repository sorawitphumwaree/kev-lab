# Manual test checklist

Start the server and open http://127.0.0.1:8018.

- Start from the blank page, enter a State, and add a question.
- Try Choice, Yes / No and Score, including optional descriptions.
- Add and remove questions, choices and score levels; reorder score levels.
- Switch a question's type and back; its previous fields should remain.
- Run several questions together and inspect the result beneath each card.
- Change a field after a run; the old result should be marked as stale.
- Try empty fields and duplicate question/choice names; submission should be blocked.
- Load each example and inspect its fields and generated JSON under Advanced.
- Choose a Choice question for the option-order check and inspect all six runs.
- Export session JSON; check the model revision, requests and responses.
- Edit a loaded example and rerun; its exported source_example should be null.
- Clear the form; inputs should reset while session history remains.
- Reload; the draft and history should reset.
- Stop and restart the server. Starting twice should report the existing lab.
- Use another occupied port; startup should fail before loading a second model.

Run `verify.py` for the API checks. Record model decision errors separately from
application failures. Local verification reports and exported sessions are ignored
by Git and should be inspected before sharing.

## Verification scope

Reviewed on 2026-10-11: all three question types, form validation and editing,
example payloads, stale results, permutations, and native session downloads were
checked in a browser. API assertions passed on the Windows CUDA runtime and a
fresh isolated installation in a path containing spaces. The fresh runtime used
already cached model weights in offline mode. Other machines and platforms remain
unverified; model decision errors remain visible in the example workflow.
