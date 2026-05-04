## Status
**Implemented (Groups):** group creation, username-based invites, the bottom-of-screen group panel showing members (`GroupPanel.tsx` / `GroupLobby.tsx`), `groupContributionEvent` driving the green/blue/gold/red color states on member tags, and the persistent color flash. Tables: `group`, `groupMember`, `groupInvitation`, `groupContributionEvent`.
**Pending:** shelter visitation (visiting another player's shelter as a session) and guild halls — neither has a backend yet. Anything beyond the basic group system should be specced separately.

Overview:
Players can form groups with other players by creating a group, and inviting the other user via the other players username. When in a group, the bottom of the screen should be dedicated to the users in the current group, displaying Username, level, current location and activity, and an indicator that displays whether or not each group member is "involved" in what the user is currently doing. This information will be in a display tag per user, like an ID card.

Currently every user will have the basic "Scavenge" button, so every time you press it, members of your group should receive 10% of the resources you generated. When a user in your group has successfully benefited from your activities, their display tag should turn blue. Vice versa, when the user benefits from a member in their group, the contributing member should turn blue. If the user would be both green and blue, instead make them gold. Persist the color change for 10 seconds, or until a different color change would occur.

Placeholders:
Locations, and activities have not yet been explored, so a simple placeholder label will do for these fields. If the members of the group did not have access to the resource or activity you were engaging in, the relevant display tag should turn red, and if a member is doing an activity you don't benefit from, exhibit the same behavior.