# Japanese copy needing native review

Append-only. One line per key: `namespace.key` — why it needs a native check.

- `progress.usuallyReady` — time-promise phrasing ("within 15 minutes of starting"); check the counter/reading for 15ふん and overall softness.
- `progress.tabWorking` — browser tab title while generating; check it reads naturally truncated in a tab strip.
- `progress.tabReady` — browser tab title on completion; exclamation register check.
- `preview.pageOf` — page counter ("{total}ページちゅう {current}ページめ"); check counter word and hiragana spacing.
- `preview.pageAlt` — image alt fallback ("{number}ページめ").
- `preview.exitFullscreen` — aria-label for leaving immersive mode; check ぜんがめん phrasing.
- `preview.notReadyTitle` — shown when a draft book's preview is opened; softness check.
- `preview.notReadyBody` — companion line inviting the parent back into the create flow.
- `preview.continueSetup` — button back into setup; check verb form matches other CTAs.
- `preview.exportPdf` — parent-facing button inside an otherwise kid-register (hiragana) namespace; confirm standard katakana register is right here.
- `exportDialog.preparingBody` — playful "tucking every page into place" line rendered as 「一枚ずつ整えています」; check the counter word and warmth.
- `exportDialog.readyBody` — points to the browser downloads; on iOS Safari files land in 「ファイル」, check ダウンロード phrasing still guides correctly.
- `exportDialog.shareErrorBody` — post-share-failure reassurance; check ダウンロードに保存されています reads naturally.
- `landing.faq3A` — new timing promise (1分/10〜15分); check numbers read naturally and the register stays warm.
- `landing.faq4A` — rewritten to describe the current 2-tap flow; check 教えていただくと clause flows.
- `landing.faq5A` — privacy answer naming OpenAI/Google/Cloudinary and delete-on-request; legal-adjacent, needs careful native + owner review.
- `create.mascotAlt` — mascot alt now the cats; check ねこたち phrasing.
- `progress.mascotAlt` — mascot alt now the cats.
- `library.mascotAlt` — mascot alt now the cats; check Storywinkのねこたち reads naturally.
- `review.loadingReviewData` — rewritten to gentle register (おはなしを ひらいています…).
- `review.loadingReviewPage` — same value as loadingReviewData; consolidation lands in copy Phase 1.
- `review.bookIdNotFound` — reassurance rewrite; check ありますよ softness.
- `review.errorLoadingPages` — reassurance rewrite; check ぶじですよ isn't too casual.
- `review.storyGenerationFailed` — mirrors issue.failedMessage pattern.
- `review.errorLoadingReviewData` — gentle retry line.
- `review.errorCheckingStatus` — connection-blip line; check こうしんすると phrasing for "refresh".
- `review.errorFetchingStatus` — same value as errorCheckingStatus.
- `review.errorLoadingContent` — same value as errorCheckingStatus.
- `review.errorStartingIllustration` — gentle retry line.
- `review.cannotConfirm` — gentle "not ready yet" line; UI slated for deletion in copy Phase 1.
- `review.working` — now イラストの じゅんびを しています…; confirm it fits the button context.
- `review.textCannotBeEmpty` — validation line moved to gentle register.
- `review.edit` — 編集 → へんしゅう register shift; confirm hiragana works on a small button.
- `review.confirmText` — テキスト → ぶんしょう vocabulary shift.
- `review.confirmed` — 確定済み → かくていずみ register shift.
- `review.enterPageText` — placeholder moved to gentle register.
- `review.noTextYet` — invitation rewrite; check 「へんしゅう」 quoting matches the button label.
- `review.saveChanges` — 変更を保存 → へんこうを ほぞん register shift.
- `review.saveTimeout` — gentle connection line.
- `review.contentFlagged` — moderation jargon replaced with "needs a different photo".
- `bookCard.illustrationFailed` — 失敗 removed; check がうまくできませんでした length on the card.
- `bookCard.someIllustrationsFailed` — 失敗 removed.
- `bookCard.fixIssues` — 問題を修正 → ページを直す; check consistency with issue.fixPages (ページを なおす).
- `resolve.photoCouldntBeIllustrated` — content-policy jargon removed; check むずかしい写真もあるんです register.
- `orders.title` — orders page heading (ご注文の一覧); check it reads as a warm page title, not admin UI.
- `orders.subtitle` — "where your book is on its journey" line; check 見守れます warmth and whether いまどこにいるか is too anthropomorphic.
- `orders.emptyTitle` — empty state; softness check.
- `orders.emptyBody` — empty state invitation; check 道のり metaphor for a shipped book.
- `orders.emptyCta` — button back to library; matches library.yourLibrary (マイライブラリ).
- `orders.orderNumber` — "ご注文番号 {number}"; the number is a Latin order code, check spacing.
- `orders.orderedOn` — "{date}にご注文"; date is Intl-formatted per locale, check the particle works with a full date.
- `orders.quantityLabel` — 冊数 with full-width colon; counter-word check.
- `orders.totalLabel` — 合計 with full-width colon; amount is preformatted (S$...).
- `orders.stepConfirmed` — timeline step 1; check ご注文確定 vs ご注文完了.
- `orders.stepPrinting` — timeline step 2 (印刷中).
- `orders.stepShipped` — timeline step 3 (発送済み).
- `orders.trackPackage` — external courier-tracking link label; check 配送状況 register.
- `orders.attentionTitle` — failed-order panel title; check 手助け isn't odd for a service failure.
- `orders.attentionBody` — failed-order reassurance; the support email renders as a separate link below, check the sentence stands alone.
- `orders.helpPrompt` — footer help line; trailing-clause check before the support link.
- `orders.contactSupport` — support mailto label.
- `orders.trackYourOrder` — success-page link to /orders; check 注文の状況 matches stepConfirmed vocabulary.
- `orders.myOrders` — Clerk user-menu item; length check for the dropdown.
- `orders.coverAlt` — cover alt; mirrors bookCard.coverAlt.
- `orders.untitledBook` — mirrors bookCard.untitledBook (無題の絵本).
- `setup.someoneElse` — free-text chip on naming questions (そのほか…); needs to read naturally next to tappable name options for both people and pets.
- `setup.someoneElsePlaceholder` — one-line input placeholder (よびかたを いれてね); check that よびかた is the natural word for "what your child calls them".
- `progress.writingStoryFor` — "{name}の おはなしを かいています…"; name is parent-entered (often kanji) inside a hiragana line, check の attachment reads naturally.
- `progress.checkingStory` — story-QC headline ("reading it back"); check よみかえしています warmth.
- `progress.finishingTouches` — finalize-QC headline; check しあげ phrasing.
- `progress.polishingPages` — QC re-render headline; check みがいています isn't odd for illustrations.
- `preview.pageCooking` — placeholder on a page whose picture isn't ready; check いろを ぬっているところ metaphor.
- `preview.partialNote` — amber strip on a partly-finished book ("#ページは もうひといき"); check もうひといき register and the counter.
- `reveal.ready` — the first-open moment headline (できました！); exclamation register check.
- `reveal.madeFor` — "{name}のための おはなしです"; name may be kanji, check ため phrasing warmth.
- `reveal.readyPlain` — no-name fallback subline.
- `reveal.open` — the single reveal CTA (えほんを ひらく).
- `whatNow.readAgain` — end-of-book action; verb form check.
- `whatNow.orderPrint` — print CTA (unused for ja today but catalog-complete); check プリント vs いんさつ.
- `whatNow.savePdf` — primary end-of-book action for ja.
- `whatNow.printSoon` — honest "printing comes to Japan soon — tell us" tap line; needs careful native check (register, タップで おしえてね casualness, no notification promise implied).
- `whatNow.printThanks` — post-tap thanks; must not promise a follow-up notification.
- `whatNow.dismiss` — aria-label for the card's close button.
- `library.emptyTitle` — empty-shelf invitation line (絵本づくりは、1枚の写真から。); check the punchy noun-ending register fits the gentle voice.
- `library.emptyCta` — coral CTA under it (はじめての絵本をつくる).
- `bookCard.continueMaking` — DRAFT card resume line/button (この絵本のつづきをつくる); check つづきをつくる phrasing.
- `bookCard.writingStory` — GENERATING shimmer on the library card (おはなしを書いています…); mixed kana/kanji register vs progress.writingStoryFor.
- `bookCard.storyReady` — STORY_READY card line (おはなしができました。見てみてね); check 見てみてね casualness toward parents.
- `bookCard.takeALook` — STORY_READY button (見てみる).
- `bookCard.savePdf` — kebab item, mirrors whatNow.savePdf (PDFを保存).
- `create.createFailedHint` — reassurance under a failed book start (しゃしんは ぶじですよ); softness check.
- `create.photosLeftBehind` — toast when slow uploads are left behind after 60s; check さきに すすみました reads as gentle, not dismissive.
- `create.tipsTitle` — photo-tips block heading on the upload screen.
- `create.tipVariety` — tip line (places/faces/details); check ちいさな はっけん for "little details".
- `create.tipArc` — beginning/middle/end tip; check はじまり・なか・おわり with interpuncts in the kid register.
- `create.tipSkipDupes` — near-duplicates tip; check 1まいで じゅうぶん warmth.
- `setup.coverLocked` — page-delete guard for the cover photo; check the two-step instruction flows naturally.
- `setup.minPages` — page-delete guard (min 2 photos).
- `issue.retryFailed` — retry-tap failure toast; register matches issue.failedMessage.
- `review.coverBadge` — cover badge on the review card (ひょうし, mirrors setup.coverBadge).
- `preview.opening` — flipbook loading line (えほんを ひらいています…).
- `preview.loadError` — friendly load failure; mirrors review.errorLoadingReviewData phrasing.
- `preview.signInToSee` — 401 mapping; check ログインしてくださいね softness for a checkout-adjacent surface.
- `preview.notFound` — mirrors review.bookIdNotFound.
- `preview.backToLibrary` — button + aria; matches progress.goToLibrary vocabulary (ライブラリー).
- `preview.options` — options sheet title/aria (えほんの オプション).
- `preview.prevPage` / `preview.nextPage` — flip-arrow aria labels.
- `preview.enterFullscreen` — aria for entering immersive mode; pairs with exitFullscreen.
- `preview.showGallery` / `preview.hideGallery` — landscape gallery toggle aria; check いちらん for the thumbnail strip.
- `print.title` — print sheet heading (印刷を注文, mirrors bookCard.orderPrint).
- `print.subtitle` — sheet subline (本棚に飾れる、ほんものの絵本です。); warmth + 飾れる check.
- `print.noCover` — placeholder when no cover art yet (表紙はこれから); check the fragment reads naturally.
- `print.untitledBook` — mirrors bookCard.untitledBook.
- `print.pageCount` — {count}ページ counter.
- `print.perBook` — unit price line (1冊 {price}); spacing check with S$ amounts.
- `print.quantity` / `print.decreaseQuantity` / `print.increaseQuantity` — quantity label + stepper aria; counter word 冊.
- `print.subtotal` — 小計 with plural-other 冊 counter.
- `print.shipping` / `print.total` — money rows (送料 / 合計).
- `print.arrives` — delivery window (お届けまで{min}〜{max}営業日ほどです); check ほど hedging.
- `print.checkout` — pay button (お支払いへ · {price}); check the middot with a price.
- `print.startingCheckout` — pre-redirect button state; check ご案内しています isn't overly formal.
- `print.checkoutError` — money-step failure; "nothing was charged" rendered as 請求はされていません — legal-adjacent, careful check.
- `print.shipsTo` — SG/MY shipping note.
- `notifications.title` — bell header (おしらせ).
- `notifications.bellUnread` — bell aria with unread count (未読{count}件).
- `notifications.loading` — bell loading line.
- `notifications.empty` — bell empty state; check ここに届きますよ warmth.
- `notifications.bookCompleted` — bell title for a finished book (「{title}」ができあがりました！).
- `notifications.bookPartial` — bell title for a partly-finished book (もうすぐ完成です).
- `notifications.bookFailed` — bell title for a failed book (うまくいきませんでした); softness check, no blame.
- `notifications.orderShipped` — bell title for a shipped order (発送されました！).
- `notifications.orderIssue` — bell title for a failed/cancelled order; mirrors orders.attentionTitle 手助け phrasing.
- `notifications.justNow` / `notifications.minutesAgo` / `notifications.hoursAgo` / `notifications.daysAgo` — relative timestamps; check 分前/時間前/日前 without spaces.
- `orders.confirmedTitle` — success-page headline (ご注文ありがとうございます！); happy register check.
- `orders.confirmedBody` — success-page subline (印刷じゅんびを進めています); mixed kana じゅんび choice needs a look.
- `orders.orderNumberLabel` — bare label above the order code.
- `orders.printingTitle` — next-steps card heading (印刷とお届け).
- `orders.printingBody` — printer + delivery window line; mirrors print.arrives phrasing.
- `orders.backToLibrary` — success-page primary button; mirrors orders.emptyCta.
- `orders.loading` — success-page suspense line (ご注文内容を確認しています…).
- `resolve.removeError` — page-remove failure; standard polite register like the rest of resolve.
- `resolve.textStartError` — page-text start failure; check ぶんしょうづくり coinage.
- `resolve.saveTextError` — save failure for a new page's text.
- `resolve.illustrateStartError` — illustration start failure; mirrors review.errorStartingIllustration but in resolve's register.
- `resolve.generateStory` — now おはなしをつくる (was ストーリーを生成); consistency with landing.createYourStorybook check.
- `resolve.generatingTextCount` — rewritten without テキスト/生成 (あたらしい#ページのぶんしょうを書いています…); counter + plural-other check.
- `resolve.reviewSubtitle` — Confirm tap removed; new line invites reading + optional editing (気になるところは編集してください).
- `resolve.illustrateBook` — unified to イラストをつくる to match review.illustrateBook.
- `pageMenu.removePage` / `removePageTitle` / `removePageBody` / `removeConfirm` / `pageRemoved` / `removeError` — bridge-page removal (app-authored pages); check 「けす」 register vs 「さくじょ」, and えいきょうしません naturalness.
- `resolve.bridgeCouldntBeDrawn` — bridge fix-card framing ("we added this little page…"); check たした ページ phrasing for an app-authored page.
- `resolve.tryDrawingAgain` — bridge primary action (もういちど かく); check it reads as "draw again", not "write again" (かく ambiguity — may want えを かきなおす).
- `resolve.bridgeRedrawStarted` / `bridgeRedrawError` — redraw progress/failure lines; かきなおしています register check.
- `review.bridgePlaceholder` — imageless bridge card at review; quotes the イラストをつくる button label — verify it stays in sync if that label changes.
- `setup.childNameAgain` — prefilled-name confirmation line (また {name}の えほんですね！); {name} is parent-entered (often kanji) inside a hiragana line — check の attachment, and that ですね register isn't presumptuous when the new book is for a different child.
- `email.readyCompletedSubject` — ready-email subject (「{title}」ができあがりました); lives in apps/workers/src/lib/email.helpers.ts, not next-intl; parent-facing standard polite register, check with a kanji title inside 「」.
- `email.readyCompletedBody` — ready-email body (すべてのページにイラストが入りました。ひらいてみてください。); check イラストが入りました phrasing and the invitation softness.
- `email.readyPartialSubject` — PARTIAL variant subject (「{title}」が読めるようになりました); must promise readable-now without claiming finished.
- `email.readyPartialBody` — PARTIAL body (いくつかのページは、あとすこしで完成します。アプリからかんたんに仕上げられます。); check 仕上げられます isn't stiff and the line doesn't over-promise auto-fixing.
- `email.readyButton` — the single coral button (えほんをひらく); mirrors reveal.open.
- `email.readyFooter` — footer line (Storywink.ai より); check より reads as a warm sign-off, not a formal letter closing.
- `setup.stripPeeking` — librarian-strip opening line (おしゃしんを ちらり…); check ちらり as a standalone playful fragment.
- `setup.stripFaces` — librarian-strip second line (だれが いるかな…); wondering register check.
- `setup.stripReading` — librarian-strip holding line (えがおの おはなしを よんでいます…); check the "reading between the smiles" metaphor survives as えがおの おはなし.
- `setup.stripQuestions` — arrival line when capture questions exist (ちいさな しつもんが いくつか みつかりました。); softness check for "questions for you".
- `setup.stripAllRead` — arrival line with zero questions (よみおわりました。おしゃしんが たくさん おしえてくれました。); check the photos-as-subject personification reads warm, not odd.
- `setup.stripRest` — settled line after a slow or failed analysis (ここからは おまかせしますね。); must never hint at failure; check おまかせしますね register.
- `setup.stripAlt` — mascot alt text (おしゃしんを よんでいる マスコット); plain descriptive alt.
- `setup.howToTellIt` — story-framing section label (どんなふうに つたえましょう？); check つたえる vs かたる for "tell".
- `setup.editSummary` — pencil-row aria/label for editing the AI summary (なおす); check it reads as "touch this up", not "repair an error".
- `setup.addNote` — quiet button when no summary exists (そのひの メモを かく); check メモ register for a parent note about the day.
- `landing.heroLead` / `heroTrail` — rebuilt hero sentence 「今夜の絵本の主役は、あなたの小さな◯◯です。」; the rotating word sits mid-sentence, check the 、 placement and that every rotating word (ヒーロー〜しょうぼうし) reads naturally before です。.
- `landing.heroSubtitle` — three-beat subhead ending 「あの顔を見てください。」; check the fragment rhythm isn't too clipped and 「あの顔」 lands as warm, not vague.
- `landing.createYourStorybook` — THE sitewide CTA, now 「わが子の絵本をつくる」; check わが子 register (intimate vs slightly formal) against the app's お子さま voice.
- `landing.ctaMicrocopy` — 「作成も読むのも無料・通常15分ほどで完成・カード登録不要」; nakaguro-separated microline, check it scans in one glance on mobile.
- `landing.morphCaption` / `morphCaptionFallback` — morph-card captions; fallback 「実際につくられた絵本です」 must read as proof, not disclaimer.
- `landing.morphPageAlt` / `readBookAria` — alt/aria with 「{title}」; titles are English book names inside kagi brackets, check that mix.
- `landing.proofPrefix` / `proofSuffix` — split heading 「まずは、」+「一冊読んでみて」 (suffix in coral); check the split point survives the color break.
- `landing.proofSub` — 「実際の家族写真からつくられた3冊です。…」; counter 3冊 + invitation register.
- `landing.tapToRead` — replaces "Peek inside!"; 「タップして読んでみて」 friendliness check.
- `landing.chipLabel` / `styleNames.*` — chips like 「かわいい・16ページ」; check nakaguro + counter, and style names かわいい／おりがみ／ペンとえんぴつ as art-style labels (おりがみ for "Paper Origami", ペンとえんぴつ coinage).
- `landing.likenessLine` — the "will it look like my kid" reassurance; check 「本当にうちの子に似るの？」 colloquial opener against the surrounding polite register.
- `landing.step1Title`〜`step4Caption` — four rebuilt how-it-works steps; step2 「その子だけの一冊に」/「…エピソードを添えて」 future-proof phrasing; step4 caption deliberately omits print (JP can't order yet) — must stay in sync with print availability.
- `landing.hiwReassurance` — 「作成中はアプリを閉じても大丈夫。できあがったらすぐ読めます。」; check 大丈夫 softness.
- `landing.keepsakeTitle` / `keepsakeSub` — 「ひとつの物語、3つの残しかた」/「…気に入ったら、かたちに残せます。」; sub avoids promising print orders in JP — check かたちに残せます isn't read as a print promise.
- `landing.keepsakeCard1Label`〜`keepsakeCard3Body` — ladder cards 今夜／今週／準備ができたら; card2 mentions grandparents (おじいちゃんおばあちゃん) — register check; card3Body is the SG/MY-shippable variant (not shown in ja today).
- `landing.keepsakeCard3SoonBody` — the variant ja users actually see: 「…お住まいの地域でもまもなくご注文いただけるようになります。」; must promise nothing concrete — check まもなく isn't over-committal.
- `landing.keepsakeRibbon` — featured-card ribbon 「記念の一冊」; three-word badge, check it works rotated on a small pill.
- `landing.keepsakeShipping` — honesty line 「印刷の配送は現在シンガポール・マレーシアのみ。…」; legal-adjacent, keep blunt.
- `landing.safetyLine` — 「お写真は絵本づくりだけに使います。販売や共有は一切しません。」; check 一切しません firmness reads trustworthy, not defensive.
- `landing.faqPrefix` / `faqSuffix` — split FAQ heading 「よくある」+「ご質問…」; suffix carries the coral + ellipsis.
- `landing.faq1A` — rewritten pipeline answer (photos → name/style → episodes → story → illustrations); check エピソードも添えられます matches the setup screen's framing vocabulary.
- `landing.faq3A` — new timing answer 「作りはじめてから15分ほどで完成します。…進みぐあいはいつでも見られて…」; check 進みぐあい (vs 進捗) register.
- `landing.faq6Q` / `faq6A` — new print/keep entry; states SG/MY-only shipping plainly; PDF described as きれいなPDF (not 印刷品質) on purpose.
- `landing.finalTitle` — closing band 「今夜の主役は、あなたのお子さまかもしれません。」; check かもしれません lands as an invitation, not uncertainty.
- `landing.readAgain` — overlay restart 「もういちど読む」; hiragana もういちど matches the reader's kid-register.
- `landing.overlayStyle` — label 「スタイル：」 before a localized style name; full-width colon check.
- `landing.closePreview` / `prevPage` / `nextPage` — overlay aria labels; plain descriptive register.
- `landing.howItWorksAlt` — four-step alt text; comma-separated step list naturalness.

## Storydust motif adoption (2026-07-07)

- `review.writingWait` — full-screen write-wait line 「{name}のおはなしを、いっページずつ書いています…」; {name} is the child's given name with no honorific — check whether ちゃん/くん-less address reads warm here, and the いっページずつ counter (vs 1ページずつ).
- `review.writingWaitNoName` — same line before the book loads (おはなしを、いっページずつ書いています…); must read complete without a subject.
- `resolve.fixingPage` — resolve-flow working panel 「そのページを なおしています…」; check なおす reads as "tidying up", never "repairing your mistake".
- `orders.settingUp` — post-checkout fallback 「ご注文を じゅんびしています…」; keigo register check against the surrounding orders copy (ご注文内容を確認しています…).
- `notifications.justAMoment` — bell dropdown working line 「しょうしょう おまちください…」; hiragana しょうしょう chosen for the kid-register — check it doesn't read as baby-talk in a utility dropdown.
- `errorPages.errorTitle` — route error headline 「あら！このページが えほんから すべりおちてしまいました。」; storybook metaphor check — must stay reassuring when real work was interrupted.
- `errorPages.errorRetry` — 「もういちど ためす」; matches the reader-overlay's もういちど register.
- `errorPages.notFoundTitle` — 404 headline 「そのページは みつかりませんでした。」; plain and calm on purpose.
- `errorPages.goHome` — 「ホームへ もどる」; check ホーム vs トップ for the landing page.

## 2026-07-12 — X1 object naming chip (expansion/x0-x1)

- `setup.itsCalled` — the free-text affordance on the companion-object naming chip 「なまえが あるよ…」; should invite the parent to type the toy's pet name — check register against `setup.someoneElse` (「だれか ほかのひと…」 pattern).
- `setup.objectNamePlaceholder` — input placeholder 「なんて よんでいますか？」; the subject is the child's beloved toy/object ("what do you [as a family] call it?") — confirm it can't read as asking the reader's own name.

## 2026-07-12 — X3 learning words (expansion/x3-learning-words)

- `setup.learningWordsAdd` — collapsed affordance in the framing block 「いま おきにいりの ことばは ありますか？」; curiosity register, must not read as a study feature.
- `setup.learningWordsPlaceholder` — chip input placeholder 「ことばを いれてね」.
- `setup.learningWordRemove` — aria-label for removing a word chip 「{word} を けす」; check けす vs 削除 for the register.

## 2026-07-12 — X6 character library (expansion/x6-avatars)

- Whole new `characters.*` namespace (36 keys): the shelf, the studio steps, the keep-this-character card. Register aims child-adjacent but parent-facing; check けす vs 削除 across delete strings and のこす for "keep as a character".
- `library.charactersTab` — 「キャラクター」 tab chip next to Books.
- `characters.matchQuestion/matchYes/matchNo/matchLinked` — the setup confirm row linking an account character to a new book; register check on ちがいます (soft decline).

## 2026-07-12 — X6d avatar-first stories (x6d-avatar-stories)

- Whole new `avatarStories.*` namespace (38 keys): the create-page character card, the cast→spark→length flow, and the shelf CTA. Register aims warm parent-facing with child-adjacent story copy; the six spark chips (`sparkRainy`…`sparkDragon`) read aloud to the child, so hiragana-lean phrasing was chosen — check they sound like book titles a parent would say, not app labels.
- `avatarStories.cardTitle` — 「{name}となかまたちと」 doubles the と; check rhythm (「{name}とおともだちと」 was the runner-up).
- `avatarStories.length12` — 「ちょうどいい定番」 mixes registers (hiragana + 定番); confirm 定番 reads natural to parents here.
- `avatarStories.styleDrawing/styleRepairCta` — {style} interpolates the art-style label from `setup.styleVignette` etc.; check particle fit (「みんなを○○で描く」).
- `avatarStories.castPeopleFull/castCompanionsFull` — soft cap explanations; check the em-dash pause reads naturally or should become 「。」.
- (review round) `avatarStories.sparkDragon` replaced by 「いちばんゆうかんなおふろタイム」 (the dragon premise contradicted the never-invent-characters rule); `cardLastTime` now 「前回はここからはじめました」; new keys `loadTrouble/loadRetry/castNeedsPerson/createNotReady` and `characters.deleteStarsInStories` — the delete-block copy is the one to scrutinize (削除 vs けす register, and whether 出演中 reads warm enough).
- (review round 2) ja polish: full-width ？ across `avatarStories`, 「：」 in `cardExplainer`, `styleRepairCta/styleDrawing` now 「みんなを「{style}」のタッチで描く」 (label-safe), `styleMismatchHint` → 「いちど描きなおせば、みんな おそろいになります」, `characters.deleteStarsInStories` rewritten in the shelf's spaced-kana けす register.

## 2026-07-12 — X7 cast page + batch studio (x7-cast-page-batch)

- `characters.cutoutAlt` — alt text for the full-body waving cutout 「こんにちはと てをふる {name}」; check the と-quotative reads naturally for an image description, and register against `portraitAlt` (えほんの キャラクターになった {name}).
- `characters.*` batch studio block (13 new keys, 5 old studio keys removed): the unified photos→confirm→style flow. Ones to scrutinize: `lookingThrough` 「しゃしんの みんなに あいさつちゅう…」 (あいさつちゅう register — playful or too cute?); `drawCount` 「キャラクターを かく（{count}）」 chose a counter-free parenthetical over にん/ひき/こ because the batch mixes people, pets, and toys; `capStopped` uses 「{count}こ」 for the same mixed-batch reason — check it can't read as belittling when the batch is all people; `zeroTitle` 「かけそうな こ」 (こ for subjects incl. pets/toys — confirm); `pickAtLeastOne` 「どれか ひとつ えらんでね」 (ひとつ over ひとり for the mixed case); `detectionExpired` should read warm, not apologetic.
- (fix round) three new `characters.*` keys from the review: `stillUploading` 「しゃしんを {count}まい よみこみちゅう…」 (photo-count counter まい); `capFull` 「いまは キャラクターの わくが いっぱいです。」 (character-slot-full, matches `capStopped` わく register); `someFailed` 「{made}こ つくれました。{missed}こは うまくいかなかったので、もういちど ためせます。」 (partial-success report, こ counter for the mixed batch, うまくいかなかった over 失敗 register). Check the two counters (まい for photos, こ for characters) read naturally.
- (review-of-shipped round) one new key `characters.drawingsNeedRetry` 「キャラクターは できましたが、おえかきは もういちど ひつようです。カードの「もういちど かく」を おしてね。」 — fires only when every created character's drawing job needs a retry (queue hiccup); quotes the shelf's `drawAgain` label 「もういちど かく」 verbatim so the parent can find the button. Check おえかき register and the embedded 「」 quoting.

## 2026-07-13 — X8 create chooser (x8-create-chooser)

- `create.backToChooser` — quiet back link above the extracted photo flow at /create/photos, returning to the /create chooser 「もどる」; only shown when the chooser exists (behind NEXT_PUBLIC_AVATARS_ENABLED). Check もどる matches the back-affordance register used elsewhere (e.g. `setup.goBack`, `avatarStories.back`).
- `create.pathPhotosTitle` — Card A title on the chooser 「きょうの しゃしんで えほんを つくる」; the fast photo→book path. Check the の-chain reads as an inviting title, not a form label.
- `create.pathPhotosBeat1` — Card A journey beat 1 「しゃしんを えらぶ」; terse strip label under a photo glyph.
- `create.pathPhotosBeat2` — Card A journey beat 2 「おはなしと えは おまかせ」; "we write & draw" — check おまかせ carries the reassuring "leave it to us" tone.
- `create.pathPhotosBeat3` — Card A journey beat 3 「せかいに ひとつの えほん」; "one keepsake book" — check せかいに ひとつ doesn't over-promise vs the English "one keepsake".
- `create.pathPhotosChip` — Card A "best for" chip 「いちばん はやい・おでかけの あとに ぴったり」; the ・ stands in for the English em dash — confirm it reads as a natural pause, not two disjoint labels.
- `create.pathFriendsTitle` — Card B generic title 「ものがたりの キャラクターを つくる」; shown until the avatar snapshot resolves. Check register against `avatarStories.cardTitleGeneric`.
- `create.pathFriendsTitleNamed` — Card B personalized title 「{name}と なかまたちと あそぶ」; {name} is the star character. Doubles と like `avatarStories.cardTitle` — check rhythm and that あそぶ ("play with") fits a create CTA.
- `create.pathFriendsBeat1` — Card B journey beat 1 「かぞくや ペットを とうろく」; "add your people" widened to family/pets. Check とうろく ("register") isn't too systemy for a warm strip.
- `create.pathFriendsBeat2` — Card B journey beat 2 「キャラクターに へんしん」; "they become characters" — check へんしん ("transform") reads playful, not literal.
- `create.pathFriendsBeat3` — Card B journey beat 3 「なんどでも ものがたりの しゅやくに」; "star in story after story" — check しゅやく ("lead role") and なんどでも land warmly.
- `create.pathFriendsChip` — Card B "best for" chip 「いっしょに おはなしを つくるのに ぴったり」; "best for making up stories together". Check いっしょに…つくる register.
- `create.pathLastTime` — small coral line on the remembered card 「まえは ここから はじめました」; the returning-user nudge. Check against `avatarStories.cardLastTime` 「前回はここからはじめました」 — this one is spaced-kana, confirm the divergence is intentional or align them.

## 2026-07-14 — X11 Track A fork & shelf polish (x11-a)

- `header.myCharacters` — new key for the burger nav row and the Clerk account-menu item that link to the character shelf 「うちのキャラクター」; set verbatim to `characters.title` so the menu word and the page heading always agree. No fresh register question — it reuses copy already reviewed for the page title; the only thing to confirm is that the two must stay in lockstep (if `characters.title` ever changes register, this key changes with it).

## 2026-07-14 — X11 Track B "+ Add someone" in the wizard (x11-b)

- `avatarStories.castDrawing` — the label on an in-flight character's disabled tile in the cast grid 「おえかき中…」; mirrors the shelf's おえかき register (`characters.drawingsNeedRetry`, AvatarCard `drawing`). Check 中 vs ちゅう register against the spaced-kana studio copy, and that the … (three-dot) reads as an ongoing wait, not a truncation.
- (fix round) `avatarStories.castEmpty` reworded now the primary CTA opens the studio inline rather than sending the parent to the shelf: was 「…できあがった絵本からのこすか、キャラクターの棚でつくれます」, now 「キャラクターがまだいません — さいしょの こを かいてみよう」 ("let's draw your first one"). Chose the こ counter (matches `characters.zeroTitle` 「かけそうな こ」) over ひとり for the mixed people/pets/toys case, and かいてみよう for the app's おえかき/かく draw register. Check the invitation reads warm and that こ can't feel belittling, and that dropping the shelf mention doesn't strand parents who still want the 棚 (it survives as the quiet `castEmptyCta` link below the CTA).

## 2026-07-15 — X11 Track C character wardrobe (x11-c)

- `characters.styleDrawIn` — the sheet's per-style draw CTA 「{name}を「{style}」で かく」 ("Draw {name} in {style}"); {style} is a setup-namespace style label rendered inside 「」 quotes. Check the を…で かく particle chain reads as a natural "draw X in style Y", and that nesting a quoted {style} inside the button doesn't crowd the coral CTA.
- `characters.styleSwatchWait` — subtitle under the draw CTA 「1ぷんくらいで できます」 ("takes about a minute"); check the 〜くらいで できます register matches the app's other reassuring time promises (e.g. `progress.usuallyReady`) and isn't over-precise.
- `characters.styleDrawn` — the "drawn ✓" badge on a completed style row 「かきました」; check the plain past ました reads as a settled state (not an action), consistent with `characters.drawing` 「かいています…」's かく register.
- `characters.styleDrawing` — the "drawing…" row state 「かいています…」; deliberately mirrors `characters.drawing` minus the {name}. Confirm the shelf-context register (かいています) vs the wizard's `avatarStories.castDrawing` 「おえかき中…」 divergence is acceptable (shelf uses かいています elsewhere), and the … reads as ongoing.
- `characters.styleShowing` — aria-only swatch label 「{style}を ひょうじ」 ("Showing {style}"); screen-reader text for which outfit a swatch switches to. ひょうじ ("display") is a touch systemy — confirm it's acceptable for an aria-label, or suggest a warmer みせています/みています.
- `characters.styleSheetTitle` — the sheet H2 AND the kebab menu entry 「{name}の スタイル」 ("{name}'s styles"); check の スタイル reads as "the wardrobe of {name}" and works both as a menu action and a sheet heading (it does double duty by design).
- `avatarStories.styleDrawnSummary` — the wizard repair card's cost line 「{total}のうち {drawn} かきました」 ("{drawn} of {total} drawn"); NO counter on {drawn}/{total} because the cast mixes people/pets/toys (にん would be wrong). Check 〜のうち 〜 かきました reads as "N of the M are drawn" and the bare numerals don't feel unfinished.

## 2026-07-15 — X11 Track D story helper v1 (x11-d)

- `avatarStories.helperTitle` — the "Shape the story" step header 「お話をととのえよう」 ("let's shape the story"); a quiet header over the parent's own idea. Check ととのえる ("arrange/set right") reads as gently shaping THEIR idea, not replacing it, and that よう (let's) keeps the collaborative tone the authorship-first framing wants.
- `avatarStories.helperFrom` — the intro line quoting the parent's words 「あなたのアイデアから：「{premise}」」 ("From your idea: “{premise}”"); {premise} is the parent's raw spark shown verbatim inside 「」 quotes. Check あなたのアイデアから reads warmly (not possessive/formal), the full-width colon ： sits right before the quote, and nesting the parent's free text inside 「」 stays legible when {premise} is long.
- `avatarStories.helperSounds` — the primary accept CTA 「いい感じ！」 ("Sounds right"); the coral font-playful button. Check いい感じ！ carries the "yes, that's my story" warmth of the English rather than a flat "OK", and the ！ isn't too loud for a picture-book studio.
- `avatarStories.helperMore` — the quiet "More ideas" affordance 「ほかのアイデア」 ("other ideas"); swaps to a different take. Check ほかの ("other") reads as "show me another", and register sits below the primary CTA (quiet, not a second hero).
- `avatarStories.helperEdit` — the pencil Edit label 「書きかえる」 ("rewrite"); opens the storyline in a textarea. Check 書きかえる ("write over/rewrite") invites the parent to make it theirs and isn't heavier than the English one-word "Edit"; consider なおす if 書きかえる feels like discarding rather than tweaking.
- `avatarStories.helperSkip` — the quiet skip 「スキップ」 ("Skip"); proceeds with the raw premise. Katakana loanword chosen for a short button; confirm it's acceptable here or suggest a warmer そのまま ("as-is") — note the meaning is "skip the helper", so そのまま must not read as "keep this proposal".
- `avatarStories.helperThinking` — the waiting-state copy under the Storydust twinkle 「お話のアイデアを考えています…」 ("Sketching story ideas…"); shown while the proposal prefetch resolves. Check 考えています ("thinking up") matches the app's working-copy register and the … reads as an ongoing wait, not a truncation.
- `characters.drawAgainConfirmTitle` — the Draw-again confirm dialog title 「{name} を もういちど かきますか？」 ("Draw {name} again?"); mirrors `deleteConfirm`'s `{name} を …ますか？` shape and the `drawAgain` verb かく. Check かきますか？ reads as a gentle question, not a command, and {name} placement stays natural.
- `characters.drawAgainConfirmBody` — the dialog body 「あたらしい えは 1ぷんくらいで できて、いまの えと いれかわります。」 ("A fresh drawing takes about a minute and replaces the current one."); reuses the `styleSwatchWait` time phrasing 1ぷんくらい. Check いれかわります ("swaps out") makes the replace-the-current-one consequence clear without alarm.
- `characters.drawAgainRetryNote` — the conditional warning shown only when redrawing a rendition that did not come out 「この えは このまえ うまく かけませんでした。もういちど でも おなじ かもしれません。」 ("This drawing didn't come out last time — another try might not either."); gentle-register, matching `createError`/`someFailed`. Check うまく かけませんでした avoids sounding like a hard failure and もういちど でも おなじ かもしれません conveys "might not either" softly.
