# Каталог голосовых команд GTR BRO — покрытие

Каталог: 60 команд. Реализовано: **28**, осталось: **32**.

Группа safety закрыта полностью: правила в `bro/safety.ts` ловят намерение до модели, ответы одинаковы в текстовом и голосовом контуре.

## Осталось реализовать

| Группа | ID | Намерение | Обработчик |
|---|---|---|---|
| details | CMD-DETAIL-009 | friends_attending | `get_friends_attending` |
| details | CMD-DETAIL-010 | compare_selected | `ranking.compareSelected` |
| preference | CMD-PREF-001 | like_result | `profile.recordPreference` |
| preference | CMD-PREF-002 | dislike_result | `profile.recordPreference` |
| preference | CMD-PREF-003 | save_music_preferences | `profile.updateMusicPreferences` |
| preference | CMD-PREF-004 | save_budget | `profile.updateBudgetPreference` |
| preference | CMD-PREF-005 | set_party_size | `session.setPartySize` |
| preference | CMD-PREF-006 | set_area | `session.setArea` |
| preference | CMD-PREF-007 | clear_preferences | `profile.previewClearPreferences` |
| preference | CMD-PREF-008 | report_wrong_data | `feedback.openDataIssue` |
| preference | CMD-PREF-009 | rate_assistant | `feedback.recordVoiceRating` |
| route | CMD-ROUTE-003 | add_route_stop | `route.addStop` |
| route | CMD-ROUTE-004 | remove_route_stop | `route.removeStop` |
| route | CMD-ROUTE-005 | optimize_route_time | `route.optimize` |
| route | CMD-ROUTE-006 | preview_safe_transport | `preview_transport` |
| route | CMD-ROUTE-007 | go_home_safely | `preview_transport` |
| session | CMD-SESSION-001 | stop_speaking | `audio.stopPlayback` |
| session | CMD-SESSION-002 | repeat_last | `session.repeatLastSpeech` |
| session | CMD-SESSION-003 | make_shorter | `session.setVerbosity` |
| session | CMD-SESSION-004 | more_details | `session.expandCurrentResult` |
| session | CMD-SESSION-007 | switch_concierge | `profile.setPersonaMode` |
| session | CMD-SESSION-008 | switch_bro | `profile.setPersonaMode` |
| session | CMD-SESSION-009 | switch_unhinged | `profile.setPersonaMode` |
| session | CMD-SESSION-010 | switch_language | `profile.setLanguage` |
| transaction | CMD-TXN-001 | preview_tickets | `preview_ticket_purchase` |
| transaction | CMD-TXN-002 | start_ticket_checkout | `start_ticket_checkout` |
| transaction | CMD-TXN-003 | preview_table | `preview_table_booking` |
| transaction | CMD-TXN-004 | create_table_hold | `create_table_hold` |
| transaction | CMD-TXN-005 | preview_invites | `preview_friend_invites` |
| transaction | CMD-TXN-006 | send_invites | `send_friend_invites` |
| transaction | CMD-TXN-007 | book_transport | `book_transport` |
| transaction | CMD-TXN-008 | cancel_preview | `confirmation.cancelActivePreview` |
