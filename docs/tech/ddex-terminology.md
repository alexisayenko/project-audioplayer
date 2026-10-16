# DDEX terminology for the credits model

Research note (2026-10-16, task-0036). Alex: stick to DDEX terminology where it exists. Electrophone does NOT implement ERN; this only fixes names. Proposal only: no code or API has been renamed.

Sources actually opened:

- AVS XSD, AvsVersionId 12 (official, machine-readable): <http://ddex.net/xml/allowed-value-sets/allowed-value-sets.xsd> (all "AVS" values below are read from it).
- kb.ddex.net guides: [Communicating remixes and remixers](https://kb.ddex.net/implementing-each-standard/best-practices-for-all-ddex-standards/guidance-on-contributors%2C-artists-and-writers/communicating-remixes-and-remixers), [Differentiating versions using SubTitle](https://kb.ddex.net/implementing-each-standard/best-practices-for-all-ddex-standards/guidance-on-releaseresourcework-metadata/differentiating-versions-using-subtitle-in-ern-and-rdr-n), [Titles and subtitles in ERN-4](https://kb.ddex.net/implementing-each-standard/best-practices-for-all-ddex-standards/guidance-on-releaseresourcework-metadata/titles-and-subtitles-in-ern-4), [DisplayArtistRoles](https://kb.ddex.net/implementing-each-standard/best-practices-for-all-ddex-standards/guidance-on-contributors,-artists-and-writers/displayartistroles/), [Displaying artists for remixes for ERN-4](https://kb.ddex.net/implementing-each-standard/best-practices-for-all-ddex-standards/guidance-on-contributors%2C-artists-and-writers/displaying-artists-for-remixes-for-ern-4), [Linking different releases and resources](https://kb.ddex.net/implementing-each-standard/best-practices-for-all-ddex-standards/guidance-on-releaseresourcework-metadata/linking-different-releases-and-resources), [Original release date, release date and other dates](https://kb.ddex.net/implementing-each-standard/best-practices-for-all-ddex-standards/guidance-on-releaseresourcework-metadata/original-release-date%2C-release-date-and-other-dates).
- Not opened (so "unverified" where it matters): the ERN 4.x message specification and data dictionary pages for cardinality and exact placement of elements.

Status: V = verified in an opened source; U = unverified (name seen only in a search snippet, or placement/cardinality not read).

## Terms by concept

| Concept | DDEX term | Status | Notes |
| --- | --- | --- | --- |
| Recording | `SoundRecording` (resource); `SoundRecordingType` AVS: MusicalWorkSoundRecording, ... | V (AVS) | the thing Electrophone calls a song/recording |
| Composition | `MusicalWork`; `MusicalWorkType` AVS includes OriginalMusicalWork, Mashup, Medley, MusicArrangement | V (AVS) | work-level; we defer works |
| Release (album, single) | `Release`; `ReleaseType` AVS: Album, EP, Single, ... | V (AVS) | we defer releases |
| Title | `DisplayTitle` = {`TitleText`, `SubTitle`}; `DisplayTitleText` = whole string; `AdditionalTitle` | V | `FormalTitle`/`TitleType` not on the ERN-4 titles page: unverified |
| Version text | `SubTitle` with `SubTitleType="Version"` (also `Location`); ERN-4: 0..n, repeatable | V | "Digital Dog Remix", "Radio Edit", "Live Version"; venue goes in a separate `Location` subtitle |
| Version category | `VersionType` AVS: ACappellaVersion, AlbumVersion, AlternativeVersion, CleanVersion, DemoVersion, EditedVersion, InstrumentalVersion, KaraokeVersion, LiveVersion, MixVersion, MonoVersion, RadioVersion, RemixVersion, SessionVersion, SingleVersion, StereoVersion, UserDefined | V (values), U (parent element and cardinality; the KB remix sample shows it next to `DisplayTitleText`) | no Acoustic, Extended, Remaster, Cover, Mashup here |
| Acoustic, cover, live, studio as a relation of one resource to another | `RelatedResourceType` AVS: ACappellaVersion, AcousticVersion, AlbumVersion, AlternativeVersion, CleanVersion, Cover, DemoVersion, InstrumentalVersion, LiveVersion, Medley, OriginalRecording, RadioVersion, SingleVersion, StudioVersion, TvTrack, UserDefined | V (AVS) | the AVS definition says "A Type of a related Resource"; where it is used in a message: unverified |
| Derived recording to source | `RelatedResource` {`ResourceRelationshipType`, `ResourceId`} inside the resource; release-level `RelatedRelease` {`ReleaseRelationshipType`, `ReleaseId`, `DisplayTitle`} | V (names, ERN 4.2 KB page); cardinality U (page shows one, states no limit) | `ResourceRelationshipType` AVS: ContainsSamplesFrom, HasClip, HasContentFrom, HasPart, IsClipFrom, IsCoveredBy, IsCoverOf, IsDifferentEncoding, IsEditedVersionOf, IsImmersiveEditionOf, IsNonImmersiveEditionOf, IsPartOf, IsSampledBy, IsSlowedDownOf, IsSourceOfEditedVersion, IsSpedUpOf, UserDefined |
| Remix | `VersionType`=`RemixVersion` + `Contributor`/`Role`=`Remixer` + `SubTitle` | V (KB remix pages) | AVS definition of Remixer: "An Artist who creates a finished product that is different from the original master album or single mix" |
| Cover | `ResourceRelationshipType`=`IsCoverOf` (and `IsCoveredBy`); `RelatedResourceType`=`Cover` | V (AVS, KB example) | not a `VersionType` |
| Mashup | `MusicalWorkType`=`Mashup` ("overlaying of existing MusicalWorks ... typically results in a new piece of intellectual property") | V (AVS) | work-level, not a recording version; sources via `ContainsSamplesFrom` is our reading, unverified |
| Live | `VersionType`=`LiveVersion`, `SubTitle` "Live Version", venue as `SubTitleType="Location"` | V | |
| Acoustic | `RelatedResourceType`=`AcousticVersion` (not in `VersionType`) | V (AVS) | |
| Instrumental | `VersionType`=`InstrumentalVersion` | V (AVS) | |
| Radio edit / edit | `VersionType`=`RadioVersion` (radio), `EditedVersion` (edit); `SubTitle` "Radio Edit"; relation `IsEditedVersionOf` | V (AVS, KB) | |
| Extended | none (`MixVersion` or only a `SubTitle` such as "Extended Mix") | V (absent in AVS) | Electrophone-specific kind |
| Remaster | no `VersionType`; `OriginalReleaseDate` differs from `ReleaseDate` for remasters; `PLine` with `PLineType` `RemasteringPLine` (AVS) | V (dates KB, AVS value), U (PLine structure) | |
| Main artist | `DisplayArtist` + `DisplayArtistRole`=`MainArtist` (default if only one; several allowed) | V | `Artist` value is discouraged; `Brand`, `Composer`, `UserDefined` also exist |
| Featured artist | `DisplayArtistRole`=`FeaturedArtist` | V | DDEX does not define how a DSP shows "feat." |
| Artist order | `SequenceNumber` attribute on `DisplayArtist`; whole credit string in `DisplayArtistName` (joins such as "vs.", "&", "and" live in that string) | V | no separate join-phrase field |
| Remixer (credit) | `Contributor` (ERN-4 name of `ResourceContributor`) with `Role`=`Remixer`; may also be a `MainArtist` display artist; `ArtisticRole` in `DisplayArtist` (e.g. `Remixer`, `OriginalArtist`) is discouraged | V | `RemixedArtist` also a role value |
| Other contributors | `Contributor`/`Role` (AVS `ResourceContributorRole`): Remixer, RemixedArtist, Mixer, MixingEngineer, Vocalist, Arranger; `IndirectContributor` for non-studio roles (Composer, Lyricist, ComposerLyricist, Arranger in AVS `ContributorRole`) | V (AVS), U (`IndirectContributor` semantics) | no plain `Producer`: AVS has StudioProducer, CoProducer, ExecutiveProducer, VocalProducer, ... |
| Mixing credit ("Mixed By DJ Gvozd") | `Contributor`/`Role` = `Mixer` or `MixingEngineer`; `ClubDJ`, `DJ` also exist | V (AVS) | |
| Artist entity | `Party` in `PartyList`, referenced by `ArtistPartyReference` | V (KB remix sample), U (`PartyList` details) | |
| Original recording year | `OriginalReleaseDate` (first availability of the collection of tracks; Release-level; omit if equal to `ReleaseDate`); `ReleaseDate` = first made available in current form | V | DDEX dates are Release-level, not recording-level; precision may be year ("1968") |
| Recording copyright year | `PLine` year | U (not opened) | |
| Country | `TerritoryCode` (AVS `TerritoryCode`, ISO-based, plus `Worldwide`) | V (name in AVS), U (placement) | used for deals and release territories; DDEX has no artist-origin country that we found |
| Genre | `Genre` composite; AVS `ClassifiedGenre`, `SubGenre` | V (AVS names), U (composite) | our genres are free tags |

## Rename table (proposal, awaiting Alex)

JSON keys stay lowerCamelCase for the new structure (as task-0036 uses); legacy snake_case keys remain derived projections.

| Current | DDEX-aligned | DDEX source | Verdict |
| --- | --- | --- | --- |
| `title` | `title` (= `TitleText`) | `DisplayTitle`/`TitleText` | keep; the full line is `DisplayTitleText` |
| `artists` | `mainArtists` | `DisplayArtist` role `MainArtist` | rename (or keep `artists` and accept the drift) |
| `featured` | `featuredArtists` | `DisplayArtistRole` `FeaturedArtist` | rename |
| `released` | `originalReleaseYear` | `OriginalReleaseDate` (we store only the year of the original recording; DDEX is Release-level) | rename, note the semantic gap |
| `version.kind` | `version.versionType` | `VersionType` | rename; values lowerCamel of AVS minus "Version": remix, live, instrumental, acoustic, radio, edited, mix, demo, ... |
| `version.kind` = acoustic | `acoustic` | `RelatedResourceType` AcousticVersion | keep value, source is the other AVS set |
| `version.kind` = extended, remaster | `extended`, `remaster` | none | Electrophone-specific |
| `version.kind` = cover | `cover` | `IsCoverOf` / `RelatedResourceType` Cover | keep, DDEX models it as a relation |
| `version.kind` = mashup | `mashup` | `MusicalWorkType` Mashup | keep, DDEX models it at work level |
| `version.name` | `version.subTitle` | `SubTitle` (`SubTitleType` Version) | rename |
| `version.by` | `version.contributors` (names; role Remixer or Mixer implied by `versionType`) | `Contributor`/`Role` Remixer, Mixer, MixingEngineer | rename; per-name `role` later |
| `version.year` | `version.year` | none (Release/PLine dates are not version-specific) | Electrophone-specific |
| `version.of` | `version.relatedResources` (names) | `RelatedResource` with `ResourceRelationshipType` IsCoverOf, IsEditedVersionOf, ContainsSamplesFrom | rename; cardinality 0..n matches our list |
| `raw` | `raw` | none | Electrophone-specific |
| SongRef stub | `songRef` | DDEX uses `ReferenceId`/`ArtistPartyReference` inside a message | Electrophone-specific |
| Artist `countries` | `countries` | `TerritoryCode` is deal/release territory | Electrophone-specific |
| `genres` | `genres` | `Genre` | keep |

## Unverified

- Parent element, cardinality and message placement of `VersionType`, `RelatedResource`, `DisplayArtist`, `Contributor` (ERN 4.x spec/data dictionary not opened; only `SubTitle` 0..n is verified).
- `PLine` year, `IndirectContributor` semantics, `FormalTitle`, `PartyList` details, `Genre` composite.
- Whether DDEX has a mashup-to-source relation: only `ContainsSamplesFrom` found, our reading.

## What a DDEX ERN message looks like

Source status: SCHEMATIC, not a verbatim sample. The official samples exist only as downloads on [ERN samples](https://kb.ddex.net/implementing-each-standard/electronic-release-notification-message-suite-(ern)/ern-samples) (ERN 4.2: Samples42.zip, ERN 4.3: Samples43.zip, profile "Simple Audio Single"); I opened that page and the [ERN 4 structure](https://kb.ddex.net/implementing-each-standard/electronic-release-notification-message-suite-(ern)/ern-4-explained/ern-4-structure) page but did not download the archives (a download needs Alex's yes). The outline below uses only element names seen in the opened sources (marked in the tables above); values are invented, `...` is omitted detail. Version: ERN 4.x (the structure page says only "ERN 4"; the 4.3 namespace `http://ddex.net/xml/ern/43` is from a vendor guide, unverified from DDEX); AVS version 12.

```xml
<!-- schematic, not a verbatim sample -->
<NewReleaseMessage ReleaseProfileVersionId="...">
  <MessageHeader> sender, recipient (DDEX Party ID), creation date </MessageHeader>
  <PartyList>
    <Party> <PartyReference>P1</PartyReference> name: Teemid </Party>
    <Party> <PartyReference>P2</PartyReference> name: Joie Tan </Party>
    <Party> <PartyReference>P3</PartyReference> name: Gnarls Barkley </Party>
  </PartyList>
  <ResourceList>
    <SoundRecording>
      <ResourceReference>A1</ResourceReference>
      <SoundRecordingType>MusicalWorkSoundRecording</SoundRecordingType>
      <DisplayTitleText>Crazy (Gnarls Barkley Cover)</DisplayTitleText>
      <DisplayTitle>
        <TitleText>Crazy</TitleText>
        <SubTitle SubTitleType="Version">Gnarls Barkley Cover</SubTitle>
      </DisplayTitle>
      <DisplayArtistName>Teemid feat. Joie Tan</DisplayArtistName>
      <DisplayArtist SequenceNumber="1"> ArtistPartyReference P1, DisplayArtistRole MainArtist </DisplayArtist>
      <DisplayArtist SequenceNumber="2"> ArtistPartyReference P2, DisplayArtistRole FeaturedArtist </DisplayArtist>
      <VersionType>...</VersionType>            <!-- no value for "cover" -->
      <Contributor> ... Role (e.g. Remixer, Mixer) </Contributor>
      <IndirectContributor> ... Role (Composer, Lyricist) </IndirectContributor>
      <RelatedResource>
        <ResourceRelationshipType>IsCoverOf</ResourceRelationshipType>
        <ResourceId> ISRC of the original </ResourceId>
      </RelatedResource>
    </SoundRecording>
  </ResourceList>
  <ReleaseList>
    <Release> ReleaseReference, ReleaseType Single, DisplayTitleText, DisplayArtist, ReleaseDate / OriginalReleaseDate, ResourceGroup -> A1 </Release>
    <TrackRelease> ... references A1 ... </TrackRelease>
  </ReleaseList>
  <DealList> commercial terms (start/end dates, territories, UseType); not used by Electrophone </DealList>
</NewReleaseMessage>
```

Structure: a `NewReleaseMessage` has eight sections (verified: structure page); the five main ones in order are `MessageHeader` (sender, recipient, creation date), `PartyList` (all artists, musicians, writers, companies, referenced by id from everywhere else; new in ERN 4), `ResourceList` (SoundRecording, Video, Image: the recordings themselves with titles, display artists, contributors, related resources), `ReleaseList` (the Release such as an album or single and its TrackRelease entries, pointing at resources) and `DealList` (when, where and how the releases may be offered). `CueList`, `ChapterList`, `SupplementaryDocumentList` follow, placement not stated. Exact child order, optionality and attribute names inside each section are unverified.

### Example song mapped to DDEX

"Teemid - Crazy feat. Joie Tan (Gnarls Barkley Cover)":

| Part of the song | DDEX element | Status |
| --- | --- | --- |
| Crazy | `DisplayTitle`/`TitleText` | V |
| Gnarls Barkley Cover (text) | `SubTitle` with `SubTitleType="Version"`; also inside `DisplayTitleText` | V |
| the recording is a cover | `RelatedResource`/`ResourceRelationshipType` `IsCoverOf` pointing at the original's `ResourceId` (e.g. ISRC); `RelatedResourceType` `Cover` | V names; our reading of how to combine them is U |
| cover as a `VersionType` | none (no cover value) | V (absent) |
| Teemid | `DisplayArtist` role `MainArtist`, `SequenceNumber` 1, `Party` P1 | V |
| Joie Tan | `DisplayArtist` role `FeaturedArtist`, `SequenceNumber` 2 | V |
| "Teemid feat. Joie Tan" as typed | `DisplayArtistName` (free string; no separate join-phrase field) | V |
| original artist Gnarls Barkley | a `Party` (P3) linked only via the original resource's own `DisplayArtist`; `OriginalArtist` is an `ArtisticRole` (discouraged) | partly V; no "cover of artist name" field |
| year of the cover recording | `PLine` year (U), `ReleaseDate` of the Release | U |
| year of the original (2006) | `OriginalReleaseDate` is about the same Release's tracks, not another resource's; the original's year would sit in the original's own record | V; DDEX cannot express "original work's year" on the cover |
| platform upload year, raw source string, suggestion/confirmed flags | no concept | Electrophone-specific |
## Words adopted in data model v2

Adopted from DDEX: `DisplayArtist` roles `MainArtist` and `FeaturedArtist` as the list names `mainArtists` and `featuredArtists`, and `VersionType` as `version.type`. Everything else is Electrophone-specific; full adoption is deferred (DATA-155, [task-0043](../tasks/task-0043.md)).
