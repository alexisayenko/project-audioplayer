# Playback contexts: continuing queue and temporary audition

Accepted by Alex on 2026-10-22 in [ADR-0043](../tech/decisions.md#adr-0043-persistent-queue-and-ephemeral-visible-song-audition);
not implemented. [Requirements](../specs/playback.md#two-independent-playback-contexts-adr-0043),
[user flows](../ui-ux/journeys.md#queue-playback-and-temporary-audition-agreed-target),
[implementation task](../tasks/task-0085.md).

| Concept | Responsibility |
| --- | --- |
| Library | Collection of all songs; browsing it does not define the current queue |
| Current playing queue | Chosen sequence, current song and progression; populated explicitly from Library or future Playlists |
| Playback dock | Interface bound to the queue; its song, progress and transport always describe the queue |
| Audition | One temporary song played from its visible Library row or Song Details; only Play/Pause |

The queue is the fundamental listening context: it survives navigation and
continues in the background and with the screen locked, using phone audio
offline. An audition is ephemeral: it exists for listening to the song in
front of the user and stops when that source surface disappears, the app
backgrounds, the device locks or the app exits. Returning never starts it
again automatically.

Both outputs may sound together intentionally. Playing or pausing an audition
does not stop or alter the queue. A new audition replaces only the preceding
audition. The dock continues showing and controlling the queue, even while an
audition sounds. Add to queue is an explicit membership action, not audition
Play; playlists will be another queue source when built.

The dock is a presentation layer over client-side queue state and playback;
calling the queue a backend is a conceptual analogy, not a remote server
architecture. This decision adds no network dependency to offline playback
and no audition seek bar, volume, next/previous or separate queue controls.

Current iOS differs: row/details playback shares the queue player, and playing
a different Library song replaces the queue with matching downloaded songs.
This text is the agreed target, not a description of the shipped app; open
implementation decisions are listed in the playback specification.
