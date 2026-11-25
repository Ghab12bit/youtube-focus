# YouTube Focus

A Chrome extension that removes YouTube's attention hooks and adds a little friction before you start watching.

## Features

Every feature has its own switch in the popup, plus a master switch that turns them all off.

**Look**
- **Grey thumbnails.** Takes the colour pull out of every thumbnail, so you pick videos by title and channel.
- **Blur until hover.** On search results and the Subscriptions feed, a thumbnail only shows clearly when you hover over it.
- **Mute red signals.** Greys out the tab icon, logo, progress bar, LIVE badges and sidebar icons, and hides notification counts and unread dots.

**Friction**
- **"Why are you here?" screen.** Once per session on Home and Search, you have to type a goal before YouTube loads. The countdown length is adjustable. Video links you open directly skip this screen.
- **Soft limit.** After a set number of minutes, the page goes grey and reminds you of your goal. You can close the tab or take 10 more minutes.

**Session**
- **Timer badge.** Shows your active time this session and your goal in the bottom-right corner.

**Other sites**
- **Whole-page greyscale** on any site you add. X and LinkedIn are on the list by default.

## Install (developer mode)

1. Clone or download this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.

## How it works

- `content.js` and `content.css` run on YouTube. Settings are applied as `data-ytf-*` attributes on the page's `<html>` element, so each switch takes effect immediately.
- The overlays and timer badge are drawn in a shadow DOM, so YouTube's styles can't change how they look.
- A session ends after 30 minutes away from YouTube. Time only counts while a YouTube tab is visible.
- `background.js` registers `grey.css` and `grey.js` only for the domains on your list, so nothing runs on any other site.

Works well alongside [Unhook](https://unhook.app), which hides the sidebar, Shorts and the home feed.
