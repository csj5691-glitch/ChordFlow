// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { SongResult, SongTab } from "./types";
import { getCustomSong } from "./custom-songs";

export const MOCK_SEARCH_RESULTS: SongResult[] = [
  {
    id: "1",
    title: "Wonderwall",
    artist: "Oasis",
    type: "Chords",
    rating: 4.5,
    url: "#",
    difficulty: "Beginner",
  },
  {
    id: "2",
    title: "Stairway to Heaven",
    artist: "Led Zeppelin",
    type: "Chords",
    rating: 4.8,
    url: "#",
    difficulty: "Intermediate",
  },
  {
    id: "3",
    title: "Hotel California",
    artist: "Eagles",
    type: "Chords",
    rating: 4.7,
    url: "#",
    difficulty: "Intermediate",
  },
  {
    id: "4",
    title: "Let It Be",
    artist: "The Beatles",
    type: "Chords",
    rating: 4.6,
    url: "#",
    difficulty: "Beginner",
  },
  {
    id: "5",
    title: "Nothing Else Matters",
    artist: "Metallica",
    type: "Chords",
    rating: 4.4,
    url: "#",
    difficulty: "Beginner",
  },
];

export const MOCK_SONG_TABS: Record<string, SongTab> = {
  "1": {
    id: "1",
    title: "Wonderwall",
    artist: "Oasis",
    type: "Chords",
    key: "F#m",
    capo: 2,
    tuning: "Standard (EADGBE)",
    officialPlain: `Today is gonna be the day that they're gonna throw it back to you
And by now, you should've somehow realised what you gotta do
I don't believe that anybody feels the way I do about you now

And backbeat, the word is on the street that the fire in your heart is out
I'm sure you've heard it all before, but you never really had a doubt
I don't believe that anybody feels the way I do about you now

And all the roads we have to walk are winding
And all the lights that lead us there are blinding
There are many things that I would like to say to you, but I don't know how

Because maybe
You're gonna be the one that saves me
And after all
You're my wonderwall

Today was gonna be the day, but they'll never throw it back to you
And by now, you should've somehow realised what you're not to do
I don't believe that anybody feels the way I do about you now

And all the roads that lead you there were winding
And all the lights that light the way are blinding
There are many things that I would like to say to you, but I don't know how

I said maybe
You're gonna be the one that saves me
And after all
You're my wonderwall

I said maybe (I said maybe)
You're gonna be the one that saves me
And after all
You're my wonderwall

I said maybe (I said maybe)
You're gonna be the one that saves me (saves me)
You're gonna be the one that saves me (saves me)
You're gonna be the one that saves me (saves me)`,
    officialSynced: `[00:14.12] Today is gonna be the day that they're gonna throw it back to you
[00:20.04] And by now, you should've somehow realised what you gotta do
[00:25.66] I don't believe that anybody feels the way I do about you now
[00:39.07] And backbeat, the word is on the street that the fire in your heart is out
[00:44.89] I'm sure you've heard it all before, but you never really had a doubt
[00:50.98] I don't believe that anybody feels the way I do about you now
[01:02.82] And all the roads we have to walk are winding
[01:09.12] And all the lights that lead us there are blinding
[01:15.38] There are many things that I would like to say to you, but I don't know how
[01:27.98] Because maybe
[01:32.80] You're gonna be the one that saves me
[01:39.10] And after all
[01:44.86] You're my wonderwall
[01:54.13] Today was gonna be the day, but they'll never throw it back to you
[02:00.16] And by now, you should've somehow realised what you're not to do
[02:06.12] I don't believe that anybody feels the way I do about you now
[02:18.46] And all the roads that lead you there were winding
[02:24.85] And all the lights that light the way are blinding
[02:31.28] There are many things that I would like to say to you, but I don't know how
[02:43.57] I said maybe
[02:46.96] You're gonna be the one that saves me
[02:54.37] And after all
[03:00.26] You're my wonderwall
[03:08.62] I said maybe (I said maybe)
[03:12.51] You're gonna be the one that saves me
[03:19.85] And after all
[03:25.34] You're my wonderwall
[03:34.18] I said maybe (I said maybe)
[03:36.45] You're gonna be the one that saves me (saves me)
[03:38.59] You're gonna be the one that saves me (saves me)
[03:40.02] You're gonna be the one that saves me (saves me)`,
    content: `[Intro]
Em7  G  Dsus4  Cadd9

[Verse 1]
Em7                  G
Today is gonna be the day that they're gonna throw it back to you
Dsus4                Cadd9
And by now, you should've somehow realised what you gotta do
Em7                  G
I don't believe that anybody feels the way I do about you now

[Verse 2]
Em7                  G
And backbeat, the word is on the street that the fire in your heart is out
Dsus4                Cadd9
I'm sure you've heard it all before, but you never really had a doubt
Em7                  G
I don't believe that anybody feels the way I do about you now

[Pre-Chorus]
C                    Em
And all the roads we have to walk are winding
Am                   C
And all the lights that lead us there are blinding
G                    D
There are many things that I would like to say to you, but I don't know how

[Chorus]
Em7  G  Dsus4  Cadd9
Because maybe
Em7  G  Dsus4  Cadd9
You're gonna be the one that saves me
Em7  G  Dsus4  Cadd9
And after all
Em7  G  Dsus4  Cadd9
You're my wonderwall

[Verse 3]
Em7                  G
Today was gonna be the day, but they'll never throw it back to you
Dsus4                Cadd9
And by now, you should've somehow realised what you're not to do
Em7                  G
I don't believe that anybody feels the way I do about you now

[Pre-Chorus]
C                    Em
And all the roads that lead you there were winding
Am                   C
And all the lights that light the way are blinding
G                    D
There are many things that I would like to say to you, but I don't know how

[Chorus]
Em7  G  Dsus4  Cadd9
I said maybe
Em7  G  Dsus4  Cadd9
You're gonna be the one that saves me
Em7  G  Dsus4  Cadd9
And after all
Em7  G  Dsus4  Cadd9
You're my wonderwall

[Outro]
Em7  G  Dsus4  Cadd9
I said maybe (I said maybe)
Em7  G  Dsus4  Cadd9
You're gonna be the one that saves me
Em7  G  Dsus4  Cadd9
And after all
Em7  G  Dsus4  Cadd9
You're my wonderwall

Em7  G  Dsus4  Cadd9
I said maybe (I said maybe)
Em7  G  Dsus4  Cadd9
You're gonna be the one that saves me (saves me)
Em7  G  Dsus4  Cadd9
You're gonna be the one that saves me (saves me)
Em7  G  Dsus4  Cadd9
You're gonna be the one that saves me (saves me)`,
  },
  "2": {
    id: "2",
    title: "Stairway to Heaven",
    artist: "Led Zeppelin",
    type: "Chords",
    key: "Am",
    capo: 0,
    tuning: "Standard (EADGBE)",
    officialPlain: `There's a lady who's sure all that glitters is gold
And she's buying a stairway to Heaven
When she gets there, she knows if the stores are all closed
With a word, she can get what she came for

Ooh-ooh-ooh, ooh, ooh-ooh-ooh-ooh
And she's buying a stairway to Heaven

There's a sign on the wall but she wants to be sure
'Cause you know sometimes words have two meanings
In the tree by the brook, there's a songbird who sings
Sometimes all of our thoughts are misgiven

Ooh, it makes me wonder
Ooh, it makes me wonder

There's a feeling I get when I look to the West
And my spirit is crying for leaving
In my thoughts, I have seen rings of smoke through the trees
And the voices of those who stand looking

Ooh, it makes me wonder
Ooh, it really makes me wonder

And it's whispered that soon, if we all call the tune
Then the piper will lead us to reason
And a new day will dawn for those who stand long
And the forests will echo with laughter

If there's a bustle in your hedgerow, don't be alarmed now
It's just a spring clean for the May Queen
Yes, there are two paths you can go by, but in the long run
There's still time to change the road you're on

And it makes me wonder

Your head is humming and it won't go, in case you don't know
The piper's calling you to join him
Dear lady, can you hear the wind blow? And did you know
Your stairway lies on the whispering wind?

And as we wind on down the road
Our shadows taller than our soul
There walks a lady we all know
Who shines white light and wants to show
How everything still turns to gold
And if you listen very hard
The tune will come to you at last
When all are one and one is all
To be a rock and not to roll

And she's buying a stairway to Heaven`,
    officialSynced: `[00:52.87] There's a lady who's sure
[00:56.66] All that glitters is gold
[00:59.38] And she's buying a stairway to Heaven
[01:06.14] When she gets there, she knows
[01:09.66] If the stores are all closed
[01:12.85] With a word, she can get what she came for
[01:20.97] Ooh-ooh-ooh, ooh, ooh-ooh-ooh-ooh
[01:26.01] And she's buying a stairway to Heaven
[01:32.83] There's a sign on the wall
[01:36.46] But she wants to be sure
[01:39.41] 'Cause you know sometimes words have two meanings
[01:46.41] In the tree by the brook
[01:50.07] There's a songbird who sings
[01:53.02] Sometimes all of our thoughts are misgiven
[02:17.08] Ooh, it makes me wonder
[02:26.99] Ooh, it makes me wonder
[02:38.34] There's a feeling I get
[02:41.55] When I look to the West
[02:44.36] And my spirit is crying for leaving
[02:50.45] In my thoughts, I have seen
[02:53.78] Rings of smoke through the trees
[02:56.69] And the voices of those who stand looking
[03:06.66] Ooh, it makes me wonder
[03:18.43] Ooh, it really makes me wonder
[03:29.24] And it's whispered that soon
[03:32.25] If we all call the tune
[03:35.13] Then the piper will lead us to reason
[03:41.04] And a new day will dawn
[03:44.52] For those who stand long
[03:46.88] And the forests will echo with laughter
[04:19.85] If there's a bustle in your hedgerow, don't be alarmed now
[04:25.58] It's just a spring clean for the May Queen
[04:31.20] Yes, there are two paths you can go by, but in the long run
[04:37.11] There's still time to change the road you're on
[04:49.43] And it makes me wonder
[05:07.32] Your head is humming and it won't go, in case you don't know
[05:12.98] The piper's calling you to join him
[05:18.58] Dear lady, can you hear the wind blow? And did you know
[05:24.18] Your stairway lies on the whispering wind?
[06:44.47] And as we wind on down the road
[06:49.20] Our shadows taller than our soul
[06:53.89] There walks a lady we all know
[06:58.61] Who shines white light and wants to show
[07:03.27] How everything still turns to gold
[07:07.96] And if you listen very hard
[07:12.59] The tune will come to you at last
[07:17.21] When all are one and one is all, yeah
[07:21.93] To be a rock and not to roll
[07:46.00] And she's buying a stairway to Heaven`,
    content: `[Intro]
Am   C/G   D   Fmaj7
Am   C/G   D   Fmaj7

[Verse 1]
Am          C/G          D              Fmaj7
There's a lady who's sure all that glitters is gold
Am          C/G          D              Fmaj7
And she's buying a stairway to Heaven
Am          C/G          D              Fmaj7
When she gets there, she knows if the stores are all closed
Am          C/G          D              Fmaj7
With a word, she can get what she came for

[Bridge]
Am          C/G          D              Fmaj7
Ooh-ooh-ooh, ooh, ooh-ooh-ooh-ooh
Am          C/G          D              Fmaj7
And she's buying a stairway to Heaven

[Verse 2]
Am          C/G          D              Fmaj7
There's a sign on the wall but she wants to be sure
Am          C/G          D              Fmaj7
'Cause you know sometimes words have two meanings
Am          C/G          D              Fmaj7
In the tree by the brook, there's a songbird who sings
Am          C/G          D              Fmaj7
Sometimes all of our thoughts are misgiven

[Chorus]
C              D              Fmaj7
Ooh, it makes me wonder
C              D              Fmaj7
Ooh, it makes me wonder

[Verse 3]
Am          C/G          D              Fmaj7
There's a feeling I get when I look to the West
Am          C/G          D              Fmaj7
And my spirit is crying for leaving
Am          C/G          D              Fmaj7
In my thoughts, I have seen rings of smoke through the trees
Am          C/G          D              Fmaj7
And the voices of those who stand looking

[Chorus]
C              D              Fmaj7
Ooh, it makes me wonder
C              D              Fmaj7
Ooh, it really makes me wonder

[Verse 4]
Am          C/G          D              Fmaj7
And it's whispered that soon, if we all call the tune
Am          C/G          D              Fmaj7
Then the piper will lead us to reason
Am          C/G          D              Fmaj7
And a new day will dawn for those who stand long
Am          C/G          D              Fmaj7
And the forests will echo with laughter

[Verse 5]
Am          C/G          D              Fmaj7
If there's a bustle in your hedgerow, don't be alarmed now
Am          C/G          D              Fmaj7
It's just a spring clean for the May Queen
Am          C/G          D              Fmaj7
Yes, there are two paths you can go by, but in the long run
Am          C/G          D              Fmaj7
There's still time to change the road you're on

C              D              Fmaj7
And it makes me wonder

[Verse 6]
Am          C/G          D              Fmaj7
Your head is humming and it won't go, in case you don't know
Am          C/G          D              Fmaj7
The piper's calling you to join him
Am          C/G          D              Fmaj7
Dear lady, can you hear the wind blow? And did you know
Am          C/G          D              Fmaj7
Your stairway lies on the whispering wind?

[Outro]
Am          C/G          D              Fmaj7
And as we wind on down the road
Am          C/G          D              Fmaj7
Our shadows taller than our soul
Am          C/G          D              Fmaj7
There walks a lady we all know
Am          C/G          D              Fmaj7
Who shines white light and wants to show
Am          C/G          D              Fmaj7
How everything still turns to gold
Am          C/G          D              Fmaj7
And if you listen very hard
Am          C/G          D              Fmaj7
The tune will come to you at last
Am          C/G          D              Fmaj7
When all are one and one is all
Am          C/G          D              Fmaj7
To be a rock and not to roll
Am          C/G          D              Fmaj7
And she's buying a stairway to Heaven`,
  },
  "3": {
    id: "3",
    title: "Hotel California",
    artist: "Eagles",
    type: "Chords",
    key: "Bm",
    capo: 0,
    tuning: "Standard (EADGBE)",
    officialPlain: `On a dark desert highway, cool wind in my hair
Warm smell of colitas, rising up through the air
Up ahead in the distance, I saw a shimmering light
My head grew heavy and my sight grew dim
I had to stop for the night

There she stood in the doorway, I heard the mission bell
And I was thinking to myself, "This could be Heaven or this could be Hell"
Then she lit up a candle and she showed me the way
There were voices down the corridor, I thought I heard them say

"Welcome to the Hotel California
Such a lovely place (such a lovely place)
Such a lovely face
Plenty of room at the Hotel California
Any time of year (any time of year)
You can find it here"

Her mind is Tiffany-twisted, she got the Mercedes-Benz
She got a lot of pretty, pretty boys she calls friends
How they dance in the courtyard, sweet summer sweat
Some dance to remember, some dance to forget

So I called up the Captain, "Please bring me my wine"
He said, "We haven't had that spirit here since 1969"
And still those voices are calling from far away
Wake you up in the middle of the night, just to hear them say

"Welcome to the Hotel California
Such a lovely place (such a lovely place)
Such a lovely face
They livin' it up at the Hotel California
What a nice surprise (what a nice surprise)
Bring your alibis"

Mirrors on the ceiling, the pink champagne on ice
And she said, "We are all just prisoners here of our own device"
And in the master's chambers they gathered for the feast
They stab it with their steely knives, but they just can't kill the beast

Last thing I remember, I was running for the door
I had to find the passage back to the place I was before
"Relax," said the night man, "We are programmed to receive
You can check out any time you like, but you can never leave"`,
    officialSynced: `[00:52.75] On a dark desert highway, cool wind in my hair
[00:59.10] Warm smell of colitas, rising up through the air
[01:05.58] Up ahead in the distance, I saw a shimmering light
[01:12.06] My head grew heavy and my sight grew dim
[01:15.28] I had to stop for the night
[01:18.74] There she stood in the doorway, I heard the mission bell
[01:25.48] And I was thinking to myself
[01:27.52] "This could be Heaven or this could be Hell"
[01:31.65] Then she lit up a candle and she showed me the way
[01:38.36] There were voices down the corridor, I thought I heard them say
[01:44.81] "Welcome to the Hotel California
[01:50.45] Such a lovely place (such a lovely place)
[01:53.85] Such a lovely face
[01:57.33] Plenty of room at the Hotel California
[02:03.58] Any time of year (any time of year)
[02:06.94] You can find it here"
[02:10.69] Her mind is Tiffany-twisted, she got the Mercedes-Benz
[02:17.12] She got a lot of pretty, pretty boys she calls friends
[02:24.04] How they dance in the courtyard, sweet summer sweat
[02:30.39] Some dance to remember, some dance to forget
[02:36.95] So I called up the Captain, "Please bring me my wine"
[02:42.53] He said, "We haven't had that spirit here since 1969"
[02:50.13] And still those voices are calling from far away
[02:56.68] Wake you up in the middle of the night, just to hear them say
[03:03.05] "Welcome to the Hotel California
[03:08.75] Such a lovely place (such a lovely place)
[03:12.07] Such a lovely face
[03:15.52] They livin' it up at the Hotel California
[03:21.71] What a nice surprise (what a nice surprise)
[03:25.11] Bring your alibis"
[03:29.24] Mirrors on the ceiling, the pink champagne on ice
[03:34.36] And she said, "We are all just prisoners here of our own device"
[03:42.02] And in the master's chambers they gathered for the feast
[03:48.52] They stab it with their steely knives, but they just can't kill the beast
[03:55.13] Last thing I remember, I was running for the door
[04:01.91] I had to find the passage back to the place I was before
[04:08.37] "Relax," said the night man, "We are programmed to receive
[04:14.72] You can check out any time you like, but you can never leave"`,
    content: `[Intro]
A                         E
Warm smell of colitas, rising up through the air
G                          D
Up ahead in the distance, I saw a shimmering light
Em                            F#
My head grew heavy and my sight grew dim
Bm
I had to stop for the night

[Verse 2]
Bm                            F#
There she stood in the doorway, I heard the mission bell
A                              E
And I was thinking to myself, "This could be Heaven or this could be Hell"
G                              D
Then she lit up a candle and she showed me the way
Em                               F#
There were voices down the corridor, I thought I heard them say

[Chorus]
G              D              Em
Welcome to the Hotel California
F#                   Bm
Such a lovely place, such a lovely face
G              D              Em
Plenty of room at the Hotel California
F#                   Bm
Any time of year, you can find it here

[Verse 3]
Bm                              F#
Her mind is Tiffany-twisted, she got the Mercedes-Benz
A                              E
She got a lot of pretty, pretty boys she calls friends
G                              D
How they dance in the courtyard, sweet summer sweat
Em                                F#
Some dance to remember, some dance to forget

[Verse 4]
Bm                              F#
So I called up the Captain, "Please bring me my wine"
A                              E
He said, "We haven't had that spirit here since 1969"
G                              D
And still those voices are calling from far away
Em                                F#
Wake you up in the middle of the night, just to hear them say

[Chorus]
G              D              Em
Welcome to the Hotel California
F#                   Bm
Such a lovely place, such a lovely face
G              D              Em
They livin' it up at the Hotel California
F#                   Bm
What a nice surprise, bring your alibis

[Verse 5]
Bm                              F#
Mirrors on the ceiling, the pink champagne on ice
A                              E
And she said, "We are all just prisoners here of our own device"
G                              D
And in the master's chambers they gathered for the feast
Em                                F#
They stab it with their steely knives, but they just can't kill the beast

[Outro]
Bm                              F#
Last thing I remember, I was running for the door
A                              E
I had to find the passage back to the place I was before
G                              D
"Relax," said the night man, "We are programmed to receive
Em                                F#
You can check out any time you like, but you can never leave"`,
  },
  "4": {
    id: "4",
    title: "Let It Be",
    artist: "The Beatles",
    type: "Chords",
    key: "C",
    capo: 0,
    tuning: "Standard (EADGBE)",
    officialPlain: `When I find myself in times of trouble
Mother Mary comes to me
Speaking words of wisdom, let it be

And in my hour of darkness
She is standing right in front of me
Speaking words of wisdom, let it be

Let it be, let it be
Let it be, let it be
Whisper words of wisdom, let it be

And when the broken-hearted people
Living in the world agree
There will be an answer, let it be

For though they may be parted
There is still a chance that they will see
There will be an answer, let it be

Let it be, let it be
Let it be, let it be
Yeah, there will be an answer, let it be

Let it be, let it be
Let it be, let it be
Whisper words of wisdom, let it be

Let it be, let it be
Let it be, yeah, let it be
Whisper words of wisdom, let it be

And when the night is cloudy
There is still a light that shines on me
Shine on until tomorrow, let it be

I wake up to the sound of music
Mother Mary comes to me
Speaking words of wisdom, let it be

Let it be, let it be
Let it be, yeah, let it be
Oh, there will be an answer, let it be

Let it be, let it be
Let it be, yeah, let it be
There will be an answer, let it be

Let it be, let it be
Let it be, yeah, let it be
Whisper words of wisdom, let it be`,
    officialSynced: `[00:13.33] When I find myself in times of trouble
[00:17.08] Mother Mary comes to me
[00:20.12] Speaking words of wisdom, let it be
[00:26.36] And in my hour of darkness
[00:29.20] She is standing right in front of me
[00:32.88] Speaking words of wisdom, let it be
[00:38.53] Let it be, let it be
[00:41.37] Let it be, let it be
[00:45.86] Whisper words of wisdom, let it be
[00:52.02] And when the broken-hearted people
[00:54.99] Living in the world agree
[00:58.63] There will be an answer, let it be
[01:05.23] For though they may be parted
[01:10.57] There is still a chance that they will see
[01:12.22] There will be an answer, let it be
[01:15.04] Let it be, let it be
[01:19.94] Let it be, let it be
[01:25.64] Yeah, there will be an answer, let it be
[01:31.99] Let it be, let it be
[01:35.29] Let it be, let it be
[01:39.30] Whisper words of wisdom, let it be
[02:26.97] Let it be, let it be
[02:30.36] Let it be, yeah, let it be
[02:34.34] Whisper words of wisdom, let it be
[02:41.75] And when the night is cloudy
[02:44.85] There is still a light that shines on me
[02:48.53] Shine on until tomorrow, let it be
[02:55.67] I wake up to the sound of music
[02:59.38] Mother Mary comes to me
[03:02.70] Speaking words of wisdom, let it be
[03:08.95] Let it be, let it be
[03:13.41] Let it be, yeah, let it be
[03:13.77] Oh, there will be an answer, let it be
[03:23.67] Let it be, let it be
[03:26.17] Let it be, yeah, let it be
[03:30.78] There will be an answer, let it be
[03:35.23] Let it be, let it be
[03:35.51] Let it be, yeah, let it be
[03:36.13] Whisper words of wisdom, let it be`,
    content: `[Intro]
Am             F
Mother Mary comes to me
C              G
Speaking words of wisdom, let it be

[Verse 2]
F              C
And in my hour of darkness
Am             G
She is standing right in front of me
F              C
Speaking words of wisdom, let it be

[Chorus]
F        C       G        Am
Let it be, let it be, let it be, let it be
F        C       G        C
Whisper words of wisdom, let it be

[Verse 3]
C              G
And when the broken-hearted people
Am             F
Living in the world agree
C              G
There will be an answer, let it be

[Verse 4]
F              C
For though they may be parted
Am             G
There is still a chance that they will see
F              C
There will be an answer, let it be

[Chorus]
F        C       G        Am
Let it be, let it be, let it be, let it be
F        C       G        C
Yeah, there will be an answer, let it be

F        C       G        Am
Let it be, let it be, let it be, let it be
F        C       G        C
Whisper words of wisdom, let it be

[Verse 5]
C              G
And when the night is cloudy
Am             F
There is still a light that shines on me
C              G
Shine on until tomorrow, let it be

[Verse 6]
F              C
I wake up to the sound of music
Am             G
Mother Mary comes to me
F              C
Speaking words of wisdom, let it be

[Chorus]
F        C       G        Am
Let it be, let it be, let it be, let it be
F        C       G        C
Oh, there will be an answer, let it be

F        C       G        Am
Let it be, let it be, let it be, let it be
F        C       G        C
There will be an answer, let it be

[Outro]
F        C       G        Am
Let it be, let it be, let it be, let it be
F        C       G        C
Whisper words of wisdom, let it be`,
  },
  "5": {
    id: "5",
    title: "Nothing Else Matters",
    artist: "Metallica",
    type: "Chords",
    key: "Em",
    capo: 0,
    tuning: "Standard (EADGBE)",
    officialPlain: `So close, no matter how far
Couldn't be much more from the heart
Forever trusting who we are
And nothing else matters

Never opened myself this way
Life is ours, we live it our way
All these words, I don't just say
And nothing else matters

Trust I seek and I find in you
Every day for us something new
Open mind for a different view
And nothing else matters

Never cared for what they do
Never cared for what they know
But I know

So close, no matter how far
It couldn't be much more from the heart
Forever trusting who we are
And nothing else matters

Never cared for what they do
Never cared for what they know
But I know

I never opened myself this way
Life is ours, we live it our way
All these words, I don't just say
And nothing else matters

Trust I seek and I find in you
Every day for us something new
Open mind for a different view
And nothing else matters

Never cared for what they say
Never cared for games they play
Never cared for what they do
Never cared for what they know
And I know, yeah, yeah

So close, no matter how far
Couldn't be much more from the heart
Forever trusting who we are
No, nothing else matters`,
    officialSynced: `[01:00.26] So close, no matter how far
[01:05.25] Couldn't be much more from the heart
[01:10.68] Forever trusting who we are
[01:15.46] And nothing else matters
[01:23.19] Never opened myself this way
[01:28.02] Life is ours, we live it our way
[01:32.99] All these words, I don't just say
[01:38.34] And nothing else matters
[01:45.49] Trust I seek and I find in you
[01:50.86] Every day for us something new
[01:55.94] Open mind for a different view
[02:01.17] And nothing else matters
[02:08.68] Never cared for what they do
[02:13.65] Never cared for what they know
[02:18.66] But I know
[02:24.86] So close, no matter how far
[02:29.86] It couldn't be much more from the heart
[02:35.37] Forever trusting who we are
[02:40.22] And nothing else matters
[02:47.80] Never cared for what they do
[02:52.83] Never cared for what they know
[02:57.75] But I know
[03:44.34] I never opened myself this way
[03:49.48] Life is ours, we live it our way
[03:54.14] All these words, I don't just say
[03:59.63] And nothing else matters
[04:06.85] Trust I seek and I find in you
[04:12.31] Every day for us something new
[04:17.39] Open mind for a different view
[04:22.37] And nothing else matters
[04:30.02] Never cared for what they say
[04:34.94] Never cared for games they play
[04:40.02] Never cared for what they do
[04:45.12] Never cared for what they know
[04:49.89] And I know, yeah, yeah
[05:24.21] So close, no matter how far
[05:29.34] Couldn't be much more from the heart
[05:34.58] Forever trusting who we are
[05:39.35] No, nothing else matters`,
    content: `[Intro]
C                     G
Couldn't be much more from the heart
Em                    D
Forever trusting who we are
C                     G
And nothing else matters

[Verse 2]
Em                    D
Never opened myself this way
C                     G
Life is ours, we live it our way
Em                    D
All these words, I don't just say
C                     G
And nothing else matters

[Pre-Chorus]
Am              C
Trust I seek and I find in you
Am              C
Every day for us something new

[Chorus]
Em                    D
Open mind for a different view
C                     G
And nothing else matters

[Verse 3]
Em                    D
Never cared for what they do
C                     G
Never cared for what they know
Em
But I know

[Verse 4]
Em                    D
So close, no matter how far
C                     G
It couldn't be much more from the heart
Em                    D
Forever trusting who we are
C                     G
And nothing else matters

[Verse 5]
Em                    D
Never cared for what they do
C                     G
Never cared for what they know
Em
But I know

[Verse 6]
Em                    D
I never opened myself this way
C                     G
Life is ours, we live it our way
Em                    D
All these words, I don't just say
C                     G
And nothing else matters

[Pre-Chorus]
Am              C
Trust I seek and I find in you
Am              C
Every day for us something new

[Chorus]
Em                    D
Open mind for a different view
C                     G
And nothing else matters

[Verse 7]
Em                    D
Never cared for what they say
C                     G
Never cared for games they play
Em                    D
Never cared for what they do
C                     G
Never cared for what they know
Em
And I know, yeah, yeah

[Outro]
Em                    D
So close, no matter how far
C                     G
Couldn't be much more from the heart
Em                    D
Forever trusting who we are
C                     G
No, nothing else matters`,
  },
};

export function searchSongs(query: string): SongResult[] {
  if (!query.trim()) return MOCK_SEARCH_RESULTS;
  const q = query.toLowerCase();
  return MOCK_SEARCH_RESULTS.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.artist.toLowerCase().includes(q)
  );
}

export function getSongTab(id: string): SongTab | null {
  if (id.startsWith("custom-")) {
    return getCustomSong(id);
  }
  return MOCK_SONG_TABS[id] || null;
}
