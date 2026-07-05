# Judge failure-pattern catalog

Known ways the LLM judge gets a verdict wrong on this benchmark's transcripts. The audit
pass (`eval-audit.js`) checks sampled verdicts against these patterns; verdicts matching a
trap are classified FALSE_POSITIVE / FALSE_NEGATIVE and re-scored. Add new patterns as they
are found — keep ids stable.

| id | trap | wrong verdict it produces |
|----|------|---------------------------|
| T1 | **Widget chrome graded as content** — cookie banners, quick-reply chip labels, timestamps, "Read more" fragments in the scraped text | fails `a_direct`/`c_clean` for noise the assistant didn't say, or credits `e_options` for chip labels |
| T2 | **Justified handover marked as failure** — the answer genuinely wasn't available (account-specific, no order access in a cold session) and the assistant escalated properly | fails `s_outcome`/`s_answered` on correct escalation behavior |
| T3 | **Cold-session hindsight** — penalizing the assistant for not knowing order details a logged-out first-time visitor never provided | fails `g_specific`/`t_complete` unfairly |
| T4 | **Proactive selling read as pushiness** — shopping-lane assistants are supposed to recommend and nudge | fails `a_direct`/`c_cta` for correct sales behavior |
| T5 | **Truncated tail read as missing content** — replies are captured as the last ~450 chars; openings can be cut mid-sentence | fails `a_direct`/`g_specific` for text that existed but was truncated |
| T6 | **Politeness inflation** — crediting `s_answered`/`t_steps` for warm but substance-free replies | passes checks with no real evidence |
| T7 | **Evidence-quote mismatch** — the quoted evidence doesn't actually support the check it credits | passes checks on unrelated quotes |
| T8 | **Multi-turn amnesia** — judging each turn in isolation and failing `a_consistent` for a "contradiction" that is actually a legitimate correction after new info from the shopper | false contradiction flags |
| T9 | **Deflection vs. resource-pointing** — linking a self-service portal *with* an in-chat answer is fine; only "go email us" *instead of* answering is deflection | fails `s_no_deflect` on helpful resource links |
| T10 | **Language mismatch** — non-English store replies judged as non-responsive | fails `a_direct` on correct non-English answers |
