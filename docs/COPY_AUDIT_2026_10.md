# Copy audit — 2026-10-30

*The screen-text pass of `docs/prompts/2026-10-30-documentation-reset.md`, PR 3. Scope: all 26 i18n namespaces in `src/i18n/locales/{en,de}/`. Rules applied: `docs/V4_GLOSSARY.md`, `docs/BRAND_VOICE.md` (German register), the vocabulary law of `docs/design-v4/01-foundations.md`, the honesty rule (only what the app does today), and en/de parity. Method: the three lints (`npm run lint:i18n`, `lint:v4`, `check-vocabulary`), a dead-key scan, a full read of every v4 namespace in both languages, and a signed-in walk of the v4 rooms on a local build with the prod flags.*

## Starting point

- `npm run lint` was green before this pass: en/de key sets identical, no forbidden German word (Folie, Vorlesung, Kurs, Konzept, bare Dozent, Student) in any v4 namespace, no hard-coded words in v4 JSX.
- The English side had never been checked against the glossary nouns, the AI's name, or the honesty rule. That is where almost every finding below comes from.

## Changed strings (77)

Grouped by namespace. Rule codes: glossary-en / glossary-de (the wrong noun), naming (Luna called the tutor or the assistant), register-de (Sie, missing wir in errors, non-inclusive form), honesty (describes something the app does not do), mismatch (German and English say different things), salesy.

| Namespace | Key | English before | English after | German before | German after | Rule | Note |
|---|---|---|---|---|---|---|---|
| v4Library | `library.empty.contribution.body` | Share a summary, a worked example or a set of practice questions with a Space. Whatever you publish lands here, with how it landed. | (deleted) | Teil eine Zusammenfassung, ein durchgerechnetes Beispiel oder Übungsfragen mit einem Space. Was du veröffentlichst, erscheint hier. Und du siehst, wie es ankam. | (deleted) | honesty | Unreferenced; describes publishing summaries and likes that exist only in the demo world. |
| v4Library | `library.shelf.bring.cellHint` | PDF, PPTX or a photo — drop it, or click | A PDF — drop it, or click | PDF, PPTX oder ein Foto – hier ablegen oder klicken | Ein PDF – hier ablegen oder klicken | honesty | No PPTX or photo intake. |
| v4Library | `library.shelf.bring.emptyHint` | PDF, PPTX or a photo. It becomes a page you can read, ask and remember. | A PDF. It becomes a Lesson only you can see — read it, ask it, practise it. | PDF, PPTX oder ein Foto. Daraus wird eine Seite zum Lesen, Fragen und Merken. | Ein PDF. Daraus wird eine Lektion, die nur du siehst – zum Lesen, Fragen und Üben. | honesty |  |
| v4Library | `library.shelf.nothing.shared` | Nothing shared yet. When a page is ready for others, share it from the page itself. | Nothing shared yet. | Noch nichts geteilt. Wenn eine Seite für andere bereit ist, teile sie direkt auf der Seite. | Noch nichts geteilt. | honesty | No share action exists in the reader. |
| v4Library | `library.shelf.words.empty` | Nothing written yet. Notes you write and answers you ask for gather here. | Nothing written yet. Notes you write gather here. | Noch nichts geschrieben. Notizen und Antworten, nach denen du fragst, sammeln sich hier. | Noch nichts geschrieben. Notizen, die du schreibst, sammeln sich hier. | honesty |  |
| v4Library | `library.shelf.words.lede` | Every note and every answer you asked for, each one still attached to its page. | Every note you wrote, each one still attached to its page. | Jede Notiz und jede Antwort, nach der du gefragt hast, weiterhin an ihrer Seite. | Jede Notiz, die du geschrieben hast, weiterhin an ihrer Seite. | honesty | Answers never land in Your words on a real account. |
| v4Library | `library.shelf.wordsEmpty` | Notes you write in a Lesson gather here, each one a tap from the page it was written on. |  | Notizen, die du in einer Lektion schreibst, sammeln sich hier – jede nur einen Tipp von der Seite entfernt, auf der sie entstand. | Notizen, die du in einer Lektion schreibst, sammeln sich hier – jede nur ein Tippen von der Seite entfernt, auf der sie entstand. | mismatch | Tipp means hint. |
| v4Library | `studio.failed` | Something went wrong |  | Etwas ist schiefgelaufen | Da ist bei uns etwas schiefgelaufen | register-de |  |
| v4Library | `studio.impact.emptyBody` | Share a summary, a worked example or a set of practice questions with a Space, and it will show up here with how it landed. | (deleted) | Teile eine Zusammenfassung, ein durchgerechnetes Beispiel oder Übungsfragen mit einem Space. Dann erscheint es hier, zusammen mit dem, was daraus geworden ist. | (deleted) | honesty | Unreferenced; same false capability. |
| v4Library | `studio.impact.intro` | Every contribution you’ve published, and what happened to it. Likes are shown per item — they say what people found useful, and never add up to a score. | (deleted) | Jeder Beitrag, den du veröffentlicht hast, und was daraus geworden ist. Likes stehen bei jedem Eintrag einzeln. Sie zeigen, was anderen geholfen hat, und ergeben nie eine Punktzahl. | (deleted) | honesty | Unreferenced; likes exist only in the demo world. |
| v4People | `moments.items.endorsed.detail` | An Owner endorsed “{{title}}”. |  | Ein Owner hat „{{title}}“ empfohlen. | Ein:e Inhaber:in hat „{{title}}“ empfohlen. | glossary-de |  |
| v4People | `moments.items.endorsed.title` | An Owner endorsed your work |  | Ein Owner hat deine Arbeit empfohlen | Ein:e Inhaber:in hat deine Arbeit empfohlen | glossary-de |  |
| v4People | `moments.items.used.title` | Someone learned from what you made |  | Jemand hat mit deinem Material gelernt | Jemand hat mit dem gelernt, was du gemacht hast | mismatch | Material is the glossary noun for a source document; this moment is about a practice set. |
| v4People | `social.ranking.hidden` | Only your friends see you here. |  | Hier sehen dich nur deine Freunde. | Hier sehen dich nur deine Freund:innen. | register-de |  |
| v4People | `social.ranking.showMe` | Show me to my Spaces |  | Meinen Spaces zeigen | Mich meinen Spaces zeigen | mismatch | The German dropped the object. |
| v4Reader | `exit.rail.tutor` | Tutor | Luna | Tutor | Luna | naming |  |
| v4Reader | `explain.ask.placeholderTutor` | Ask the tutor about this page… | Ask Luna about this page… | Frag den KI-Tutor zu dieser Seite … | Frag Luna zu dieser Seite … | naming | Live Explain view. |
| v4Reader | `select.ask` | Ask the tutor | Ask Luna | Tutor fragen | Luna fragen | naming |  |
| v4Reader | `spine.label` | Concepts in this Lesson | Ideas in this Lesson | Ideen in dieser Lektion |  | glossary-en |  |
| v4Reader | `timeline.slide` | Slide | Page | Seite |  | glossary-en | The unit is page in both languages; the German already said Seite. |
| v4Space | `course.exam.passed` | Exam over | Exam over | Prüfung vorbei |  | mismatch | The app knows the date passed, not the result; the German already says vorbei. |
| v4Space | `course.leave.failed` | Couldn’t leave just now. Nothing changed — try again. |  | Wir konnten dich gerade nicht austragen. Nichts hat sich geändert – versuch es noch einmal. | Wir konnten dich gerade nicht austragen. Nichts hat sich geändert – versuch es noch einmal. | register-de |  |
| v4Space | `course.owner.fileFailed` | Couldn’t be added. Try another file, or try again later. |  | Wir konnten es nicht hinzufügen. Versuch eine andere Datei oder später noch einmal. | Wir konnten es nicht hinzufügen. Versuch eine andere Datei oder später noch einmal. | register-de |  |
| v4Space | `course.owner.manager` | More in the course manager | More in the classic manager | Mehr in der Kursverwaltung | Mehr im klassischen Verwaltungsbereich | glossary | Links to the classic route; see parked finding 2. |
| v4Space | `course.owner.publishFailed` | Couldn’t change that just now. Nothing changed — try again. |  | Wir konnten das gerade nicht ändern. Nichts hat sich geändert – versuch es noch einmal. | Wir konnten das gerade nicht ändern. Nichts hat sich geändert – versuch es noch einmal. | register-de |  |
| v4Space | `course.owner.uploadFailed` | Couldn’t send that just now. Nothing changed — try again. |  | Wir konnten das gerade nicht senden. Nichts hat sich geändert – versuch es noch einmal. | Wir konnten das gerade nicht senden. Nichts hat sich geändert – versuch es noch einmal. | register-de |  |
| v4Space | `demo.lessonRow.sourceRemoved` | Source Material removed | Source Material removed | Quellmaterial entfernt | Quellmaterial entfernt | glossary |  |
| v4Space | `lesson.materialRemoved` | The original Material was removed. This Lesson still works. | The original Material was removed. This Lesson still works. | Das ursprüngliche Material wurde entfernt. Die Lektion funktioniert trotzdem. |  | glossary-en |  |
| v4Space | `manage.failed` | Something went wrong |  | Wir konnten den Space nicht laden | Wir konnten den Space nicht laden | register-de |  |
| v4Space | `map.failed` | The connections between ideas could not be mapped just now — the stars still open their pages. |  | Wir konnten die Verbindungen zwischen den Ideen gerade nicht erstellen. Die Sterne öffnen trotzdem ihre Seiten. | Wir konnten die Verbindungen zwischen den Ideen gerade nicht erstellen. Die Sterne öffnen trotzdem ihre Seiten. | register-de |  |
| v4Space | `rehearse.debrief.unkept` | Rehearsals of your own Materials are not kept yet | Rehearsals of your own Materials are not kept yet | Durchläufe mit deinem eigenen Material werden noch nicht gespeichert | Durchläufe mit deinem eigenen Material werden noch nicht gespeichert | glossary |  |
| v4Space | `rehearse.debrief.verdict.flawless` | Every one right. | Every one right. | Alles richtig. |  | salesy | Brand voice names "Flawless" as inflated praise; the German states the fact. |
| v4Spaces | `achievements.curiousMind.description` | Asked the AI tutor your first question. | Asked Luna your first question. | Dem KI-Tutor deine erste Frage gestellt. | Luna deine erste Frage gestellt. | naming |  |
| v4Spaces | `achievements.graduate.name` | Graduate |  | Absolvent | Absolvent:in | register-de |  |
| v4Spaces | `achievements.inquisitive.description` | Asked the AI tutor twenty questions. | Asked Luna twenty questions. | Dem KI-Tutor zwanzig Fragen gestellt. | Luna zwanzig Fragen gestellt. | naming |  |
| v4Spaces | `achievements.level10.description` | Reached level 10. |  | Stufe 10 erreicht. | Level 10 erreicht. | glossary-de |  |
| v4Spaces | `achievements.level10.name` | Level 10 Expert |  | Stufe 10 | Level 10 | glossary-de |  |
| v4Spaces | `achievements.level25.description` | Reached level 25. |  | Stufe 25 erreicht. | Level 25 erreicht. | glossary-de |  |
| v4Spaces | `achievements.level25.name` | Level 25 Legend |  | Stufe 25 | Level 25 | glossary-de |  |
| v4Spaces | `achievements.level5.description` | Reached level 5. |  | Stufe 5 erreicht. | Level 5 erreicht. | glossary-de |  |
| v4Spaces | `achievements.level5.name` | Level 5 Scholar |  | Stufe 5 | Level 5 | glossary-de |  |
| v4Spaces | `badges.star.own_one` | {{count}} stars. You can’t star your own Space. | {{count}} star. You can’t star your own Space. | {{count}} Stern. Deinen eigenen Space kannst du nicht markieren. |  | mismatch |  |
| v4Spaces | `badges.star.star_one` | Star this Space. {{count}} stars. | Star this Space. {{count}} star. | Diesen Space mit einem Stern markieren. {{count}} Stern. |  | mismatch |  |
| v4Spaces | `badges.star.starred_one` | Starred. {{count}} stars. Tap to remove. | Starred. {{count}} star. Tap to remove. | Markiert. {{count}} Stern. Tippen zum Entfernen. |  | mismatch |  |
| v4Spaces | `dialogs.addLesson.noUpload` | In the finished product you would attach material here and the Lesson would build itself from it. This design build creates the draft and stops there. | This creates the draft only. | Im fertigen Produkt hängst du hier Material an, und die Lektion baut sich daraus auf. Dieser Design-Build legt nur den Entwurf an. | Das legt nur den Entwurf an. | honesty | Called the product a "design build"; now says only what the dialog does. |
| v4Spaces | `dialogs.newSpace.description` | A Space is one subject, its material, and the people learning it with you. You can change any of this later. | A Space is one subject, its Material, and the people learning it with you. You can change any of this later. | Ein Space ist ein Fach, sein Material und die Leute, die es mit dir lernen. Du kannst alles später ändern. |  | glossary-en |  |
| v4Spaces | `dialogs.newSpace.descriptionLive` | A Space is one subject, its material, and the people learning it with you. | A Space is one subject, its Material, and the people learning it with you. | Ein Space ist ein Fach, sein Material und die Leute, die es mit dir lernen. |  | glossary-en |  |
| v4Spaces | `dialogs.newSpace.failed` | Couldn’t make it just now. Nothing changed — try again. |  | Das hat gerade nicht geklappt. Nichts hat sich geändert – versuch es noch einmal. | Wir konnten den Space gerade nicht anlegen. Nichts hat sich geändert – versuch es noch einmal. | register-de |  |
| v4Spaces | `home.answer.failed` | Couldn’t reach the tutor just now. Ask again in a moment. | Couldn’t reach Luna just now. Ask again in a moment. | Der Tutor ist gerade nicht erreichbar. Frag gleich noch einmal. | Wir konnten Luna gerade nicht erreichen. Frag gleich noch einmal. | naming |  |
| v4Spaces | `home.answer.thinking` | Reading your material… | Reading your Material… | Dein Material wird gelesen… |  | glossary-en |  |
| v4Spaces | `home.ask.notWired` | Not wired up yet — I can’t answer “{{question}}” until the assistant is connected. | Not wired up yet — I can’t answer “{{question}}” until Luna is connected. | Noch nicht angeschlossen: Auf „{{question}}“ kann ich erst antworten, wenn der Assistent verbunden ist. | Noch nicht angeschlossen: Auf „{{question}}“ kann ich erst antworten, wenn Luna verbunden ist. | naming |  |
| v4Spaces | `home.empty.bring` | Bring in a file | Bring in Material | Material hinzufügen |  | glossary-en |  |
| v4Spaces | `hub.chips.discover` | Discover spaces | Discover Spaces | Spaces entdecken |  | glossary-en |  |
| v4Spaces | `hub.chips.yours` | Your spaces | Your Spaces | Deine Spaces |  | glossary-en |  |
| v4Spaces | `hub.discover.title` | Find your next space | Find your next Space | Finde deinen nächsten Space |  | glossary-en |  |
| v4Spaces | `join.failed` | Couldn’t join just now. Nothing changed — try again. |  | Beitreten hat gerade nicht geklappt. Nichts hat sich geändert – versuch es noch einmal. | Wir konnten dich gerade nicht aufnehmen. Nichts hat sich geändert – versuch es noch einmal. | register-de |  |
| v4Spaces | `notifications.empty.body` | When someone likes or endorses your work, or a Space you are in publishes something, it turns up here. | When a Space you are in publishes something, it turns up here. | Wenn jemand deine Arbeit likt oder empfiehlt, siehst du es hier. Genauso, wenn ein Space, in dem du bist, etwas veröffentlicht. | Wenn ein Space, in dem du bist, etwas veröffentlicht, siehst du es hier. | honesty | Likes and endorsements exist only in the demo world. |
| v4Spaces | `notifications.items.contributor.title` | Badge earned: Contributor |  | Abzeichen erhalten: Mitwirkend | Badge erhalten: Mitwirkend | glossary-de |  |
| v4Spaces | `notifications.items.levelUp.message` | You reached level {{level}}. |  | Du hast Stufe {{level}} erreicht. | Du hast Level {{level}} erreicht. | glossary-de |  |
| v4Spaces | `notifications.items.levelUp.title` | Level {{level}} |  | Stufe {{level}} | Level {{level}} | glossary-de |  |
| v4Spaces | `states.failed.history` | Couldn’t load your study history |  | Dein Lernverlauf konnte nicht geladen werden | Wir konnten deinen Lernverlauf nicht laden | register-de |  |
| v4Spaces | `states.failed.idea` | Couldn’t load this idea |  | Diese Idee konnte nicht geladen werden | Wir konnten diese Idee nicht laden | register-de |  |
| v4Spaces | `states.failed.lesson` | Couldn’t load this Lesson |  | Diese Lektion konnte nicht geladen werden | Wir konnten diese Lektion nicht laden | register-de |  |
| v4Spaces | `states.failed.library` | Couldn’t load your Library |  | Deine Bibliothek konnte nicht geladen werden | Wir konnten deine Bibliothek nicht laden | register-de |  |
| v4Spaces | `states.failed.material` | Couldn’t load this Material |  | Dieses Material konnte nicht geladen werden | Wir konnten dieses Material nicht laden | register-de |  |
| v4Spaces | `states.failed.moments` | Couldn’t load your moments |  | Deine Momente konnten nicht geladen werden | Wir konnten deine Momente nicht laden | register-de |  |
| v4Spaces | `states.failed.next` | Couldn’t load your next thing |  | Dein nächster Schritt konnte nicht geladen werden | Wir konnten deinen nächsten Schritt nicht laden | register-de |  |
| v4Spaces | `states.failed.people` | Couldn’t load your people |  | Deine Leute konnten nicht geladen werden | Wir konnten deine Leute nicht laden | register-de |  |
| v4Spaces | `states.failed.person` | Couldn’t load this profile |  | Dieses Profil konnte nicht geladen werden | Wir konnten dieses Profil nicht laden | register-de |  |
| v4Spaces | `states.failed.practice` | Couldn’t load this practice |  | Diese Übung konnte nicht geladen werden | Wir konnten diese Übung nicht laden | register-de |  |
| v4Spaces | `states.failed.profile` | Couldn’t load your profile |  | Dein Profil konnte nicht geladen werden | Wir konnten dein Profil nicht laden | register-de |  |
| v4Spaces | `states.failed.rank` | Couldn’t load your rank |  | Dein Rang konnte nicht geladen werden | Wir konnten deinen Rang nicht laden | register-de |  |
| v4Spaces | `states.failed.settings` | Couldn’t load your settings |  | Deine Einstellungen konnten nicht geladen werden | Wir konnten deine Einstellungen nicht laden | register-de |  |
| v4Spaces | `states.failed.space` | Couldn’t load this Space |  | Dieser Space konnte nicht geladen werden | Wir konnten diesen Space nicht laden | register-de |  |
| v4Spaces | `states.failed.spaces` | Couldn’t load your Spaces |  | Deine Spaces konnten nicht geladen werden | Wir konnten deine Spaces nicht laden | register-de |  |
| v4Spaces | `states.failed.work` | Couldn’t load your work |  | Deine Arbeit konnte nicht geladen werden | Wir konnten deine Arbeit nicht laden | register-de |  |
| v4Spaces | `states.noSpaces.body` | A Space is where you keep one subject — its material, its practice, and the people learning it with you. | A Space is where you keep one subject — its Material, its practice, and the people learning it with you. | In einem Space hältst du ein Fach zusammen – sein Material, seine Übungen und die Leute, die es mit dir lernen. |  | glossary-en |  |

## Deleted keys (120, both languages)

A key was deleted only when its full path, its parent path and its leaf word appear nowhere in `src/` outside tests and mocks. Keys reached through template strings or fixtures (`hub.activity.*`, `curriculum.*`, `achievements.*.name`) were kept.

**common** (5): `achievements.firstQuiz.notificationTitle`, `languageEnglish`, `languageGerman`, `shell.switchToDark`, `shell.switchToLight`

**dashboard** (11): `continueLearning`, `dayStreak_one`, `dayStreak_other`, `progressToLevel`, `recentAchievements`, `resumeFromSlide`, `slidesProgress`, `viewAll`, `welcomeBack`, `xpProgress`, `yourCourses`

**landing** (94): `cta.headlineHighlight`, `cta.headlineLeft`, `cta.primary`, `cta.secondary`, `cta.subtitle`, `features.adaptiveQuizzes.description`, `features.adaptiveQuizzes.title`, `features.aiTutor.description`, `features.aiTutor.title`, `features.eyebrow`, `features.headlineHighlight`, `features.headlineLeft`, `features.learnMore`, `features.liveAnalytics.description`, `features.liveAnalytics.title`, `features.professorCommand.description`, `features.professorCommand.title`, `features.secureVault.description`, `features.secureVault.title`, `features.subtitle`, `features.universalAccess.description`, `features.universalAccess.title`, `footer.company`, `footer.legal`, `footer.links.about`, `footer.links.apiReference`, `footer.links.blog`, `footer.links.careers`, `footer.links.community`, `footer.links.contact`, `footer.links.documentation`, `footer.links.enterprise`, `footer.links.features`, `footer.links.pricing`, `footer.links.privacy`, `footer.links.security`, `footer.platform`, `footer.resources`, `footer.tagline`, `hero.badge`, `hero.ctaPrimary`, `hero.ctaSecondary`, `hero.headlineLine1`, `hero.headlineLine2`, `hero.preview.activeCourse`, `hero.preview.aiTutorActive`, `hero.preview.courseSubtitle`, `hero.preview.courseTitle`, `hero.preview.generatingResponse`, `hero.preview.inProgress`, `hero.preview.tutorQuestion`, `hero.scrollToExplore`, `hero.stats.accuracy`, `hero.stats.currentStreak`, `hero.stats.days`, `hero.stats.xpEarned`, `hero.subtitle`, `hero.systemOnline`, `howItWorks.eyebrow`, `howItWorks.headlineHighlight`, `howItWorks.headlineLeft`, `howItWorks.step1.description`, `howItWorks.step1.title`, `howItWorks.step2.description`, `howItWorks.step2.title`, `howItWorks.step3.description`, `howItWorks.step3.title`, `howItWorks.step4.description`, `howItWorks.step4.title`, `nav.features`, `nav.forProfessors`, `nav.howItWorks`, `nav.launchMission`, `nav.pricing`, `nav.signIn`, `professors.bullet1`, `professors.bullet2`, `professors.bullet3`, `professors.bullet4`, `professors.cta`, `professors.eyebrow`, `professors.headlineHighlight`, `professors.headlineLeft`, `professors.preview.attendance`, `professors.preview.avgScore`, `professors.preview.engagement`, `professors.preview.high`, `professors.preview.sample`, `professors.preview.title`, `professors.subtitle`, `stats.activeLearners`, `stats.questionsAnswered`, `stats.retentionRate`, `stats.userRating`

**lecture** (4): `completion.continueButton`, `recap.missedQuestions`, `recap.yourFirstAnswer`, `recap.yourRetryAnswer`

**professor** (5): `commandCenter`, `lectures.status.noPdf`, `lectures.table.launchDate`, `lectures_status.activeProtocol`, `lectures_status.noSourcePdf`

**v4Library** (1): `library.empty.toSpaces`

## Decisions left open

1. `v4Space` `manage.*` (publish modes, grounding, orphans, roles, archive, delete) and `lesson.community.*` / `concept.community.*` describe features that exist only in the demo world. They never render live (`SpaceManageScreen.tsx` redirects when the world is live; the community sections are gated behind `!live`), but they sit outside `demo.*` keys. Either move them under `demo.*` or trim them when the manage screen goes live.
2. `v4Settings` `sections.notice`, `sections.notifications.*`, `sections.visibility.publicProfile/activity` and `sections.data.export.notWired*` are the demo-only switches; live accounts see `LiveVisibilitySection` and the real export. Same standing as 1.
3. `nav`, `dashboard`, `lecture`, `professor`, `exam`, `review`, `gamification`, `upload`, `myMaterials`, `settings` (the old `/settings` page) and the badge descriptions in `common` still use the pre-v4 vocabulary (lecture, course, slide, instructor). They belong to the classic rooms, which students no longer reach; they were left alone except for dead keys.

## Parked: findings that need code, not copy

1. `src/components/UploadsIndicator.tsx:69` toasts **"Lecture created."** after an upload, hard-coded in English. **Corrected 2026-10-30:** this is not v4. `UploadsIndicator` mounts only in the classic `ConsoleTopBar`; it showed because the local build had no v4 flags and sign-in landed on `/dashboard`. Classic-room copy, left alone with the rest of decision 3.
2. `src/features/spaces/components/course/OwnerBar.tsx:151` links the Space owner to `ProfessorRoutes.COURSE_DETAIL` (the classic manager). **Checked 2026-10-30:** the route allows `['professor', 'student']`, so a student owner can open it. Not a dead end; no change.
3. `src/hooks/useLectureSubmit.ts:150,327` toast **"Success!" / "Lecture created successfully."**, hard-coded; classic rooms only.
4. `node scripts/check-vocabulary.mjs src/features/spaces` reports 189 violations in TSX (string literals and JSX text with course/lecture/slide/folder). Most are identifiers and comments the law exempts in spirit but the script counts; a pass to silence it is a separate PR.
5. One fact once: on `/v4/home` the signed-in name appears in the top-bar account chip and again in the greeting line. Layout decision, not copy.
6. `v4Reader` `timeline.slide` and `timeline.page` are two keys for one word now; the reader picks by material kind. Collapse to one when convenient.
7. The avatar button on Home and `/auth` was labelled "Luna. Say hi." in both languages, hard-coded. **Fixed** in the follow-up PR: `avatar:hero.sayHi`, German "Luna. Sag hallo."
8. The author chip on a Lesson read "Professor" in German mode. **Corrected 2026-10-30:** that is not a role word. The server sends the owner's profile name (`COALESCE(full_name, display_name)`), and the account that owns Datenbanksysteme is named "Professor". Data, not copy. The real finding behind it: when the owner has no name, `useReader.ts` fell back to a hard-coded English "Course team" (banned word). **Fixed** in the follow-up PR: `v4Spaces:people.runTheSpace`, "The people who run this Space" / "Die Leute, die diesen Space pflegen", with a test.

## Walk

Signed in as the default test account on a local build with `VITE_V4_DATA_MODE=live`, `VITE_FEATURE_V4=1`, `VITE_FEATURE_LUNA_SESSIONS=1`. Rooms read through the accessibility tree (the stage is WebGL, so screenshots are black): Home, Spaces hub, a Lesson (Datenbanksysteme, Lektion 1), Library, Settings, in English and then in German.

- Every string on those screens came from the glossary vocabulary in both languages (Space, Lektion, Seite, Bibliothek, Leute, Inhaber:in, Bearbeiter:innen). No Folie, Kurs, Vorlesung or Sie anywhere.
- Home: the greeting, the ask box ("Luna fragen"), the continue card and "Zuletzt angesehen" read cleanly. The avatar button is labelled "Luna. Say hi." in German mode: hard-coded in TSX, parked as 7 below, since fixed.
- Lesson: "Lektion 1 · 66 Seiten", the ideas list, practice, notes and "Erklär's zurück" are all German. The author chip reads "Professor": the owning account's profile name, see 8 below.
- Library: the live "bring" hint already says "Ein PDF – hier ablegen oder klicken"; the shelf, tabs and counts are consistent. Settings: language, the one live visibility switch, export and delete, nothing promised that is not there.
- One fact once: the top bar shows the name, rank and XP once; Settings repeats "Rang 1 · 70 XP" under the avatar on the same screen as the top bar is hidden there, so no duplicate. Home repeats the name (chip and greeting), parked as 5.
