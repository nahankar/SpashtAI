# AI-led grading adjudication — 8 November 2026

The owner explicitly accepts Codex's technical judgment for reference-label review. This removes the need to
wait for an outside reviewer for this engineering pilot. It does **not** make the review independent human
validation or turn a failing model test into a pass. Historical fixtures, outputs and failures remain unchanged.

## Reviewed distinctions

| Cases | Judgment and reason |
| --- | --- |
| RS-03 / RS-05 | The mechanism/contrast is reasoning even without causal words. An element can change size without a viewport change; a one-shot callback can read transient UI state. Do not demand an explanation of the tool implementation when the question asks why the technique is useful. |
| P2-07 | DOM position plus a competing manual tab order is relevant implicit reasoning. Keep the existing preferred PARTIAL and its reasoning-credit requirement; missing examples alone are not a failure. This review is not upgrading the label to fit a new output. |
| P2-06 | Preserve the correct composition concept beside the false synchronous-call advice. A false addition does not erase demonstrated knowledge; the existing preferred PARTIAL remains. |
| P2-01 and empty-reason controls | Instruction echoes and empty slogans do not establish a technical proposition. Keep the original no-answer controls; do not infer knowledge from keywords. |
| P2-08 | This is an attempted technical answer, but the relationships among its fragments cannot be interpreted reliably. The original fixture notes “packed” is a mishearing of “fact”; that spelling is not a knowledge error. Nor can the grader invent grain, measures or descriptive context. Require **ungraded review**, with no grade available to steer the next question. |
| A1-01 | The midpoint/search procedure makes the intended git-bisect operation clear despite its transcribed name. Normalize the term in the interpretation, keep original quote evidence and assess the stated procedure. |
| A1-05 | Calling a stale-element error merely a timeout and repeatedly using the same reference is an actual technical error; transcription tolerance is not a general exemption from incorrect claims. |

Primary-source checks used for this review:

- [W3C Resize Observer working draft](https://www.w3.org/TR/resize-observer/): element-size observation is the relevant distinction, not a general speed claim.
- [Cypress retry-ability](https://docs.cypress.io/app/core-concepts/retry-ability): queries/assertions retry; a `then` callback does not. This supports the mechanism expressed in RS-05.
- [W3C focus order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html): the sequence must preserve meaning and operation. Positive tabindex is not automatically a WCAG failure; the concern here is an independently maintained competing order.
- [Java CompletableFuture](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html): dependent composition, independent combination and asynchronous execution support the mixed-answer distinction.
- [Kimball grain](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/grain/) and [dimension context](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/dimensions-for-context/): these explain the actual fact/dimension distinction. They cannot establish which missing relationships a fragmented transcript intended.
- [Git bisect](https://git-scm.com/docs/git-bisect) and [Selenium stale-element errors](https://www.selenium.dev/documentation/webdriver/troubleshooting/errors/#stale-element-reference-exception): checks for normalization without excusing false subject claims.

## Reference-label change and safeguards

The new v11 fixture changes only P2-08's disposition from an allowed PARTIAL/INCORRECT grade to
REVIEW_REQUIRED. That is a substantive adjudication, made **before v11 provider tests**, because a fair grade
cannot be established without guessing at the intended relationships. Old reports remain HOLD and retain
their original labels. No earlier failure is retroactively relabelled passed.

All other selected labels and checks remain as previously frozen. Clear incomplete, incorrect and misheard-but-
interpretable answers must still receive grades. An evaluator that withholds every answer fails the fixture:
review is accepted only for the specifically declared ambiguous case. Grade availability and correct ungraded
outcomes are reported separately, not combined into a misleading grading-success percentage.

This limited AI-led review supports a bounded engineering pilot; it does not establish all-domain accuracy,
fairness across populations or a repeatability guarantee. Those limitations remain in the release evidence.
