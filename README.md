# Taiger
Assists in downloading and tagging AI artwork from various hosted services. Not for the faint of heart.

Taiger (pronounced however you want to say it, but I say "TAY-ger", kind of like saying "tagger" with a very Canadian or Minnesotan accent. :-P )
is a NodeJS service that runs on your local machine and helps you maintain a local backup of the thousands of images you have been creating
on a few of the hosted AI Art services.  It aims to do the following:

  * automate (somewhat) the process of capturing the various metadata used to create the artwork -- prompt, various parameters, etc. -- from each of the services it aims to support
  * automate (insofar as possible) the process of downloading a full-quality version of the artwork
  * automate the process of embedding the metadata INTO the downloaded artwork, so the metadata can stay associated with the image and they can be indexed together by other tools (such as [DiffusionToolkit](https://github.com/RupertAvery/DiffusionToolkit) or other image management software that fully indexes image metadata)
  * For some services (StarryAI and NightCafe) it also partially automates the task of capturing metadata for creations you have "liked" -- depending on whether the creators of those artworks chose to share prompts or not

BIG disclaimer: this software was written PURELY for my own utility. It is not easy to figure out. It needs more documentation -- probably a lot more -- before it could really do much for anybody besides me. It is on GitHub purely because I needed to migrate the code from an old PC to a newer one, and I needed a good place to store it. If you are looking for something that "just works", please, this is not the project for you.  It works for me, but it may not do what you need, and unfortunately I am busy enough that I might not have time to add features or fix bugs on anybody's schedule but my own.  However, if you're just looking for some code snippets to do one thing or another, you might find some interesting things in here.

It currently supports (to varying degrees) the following services:

  * [StarryAI](https://starryai.com/)
  * [NightCafe](https://creator.nightcafe.studio/)
  * [Civitai](https://civitai.com/) -- for downloading tagged versions of stuff you've generated with their on-site creation tools
  * [Novita](https://novita.ai/) -- although Novita just deprecated their FLUX dev models, so... boo, hiss
  * ~~[Dezgo](https://dezgo.com/)~~ -- may be out of date, I haven't checked in a long time
  * ~~[Unstability](https://www.unstability.ai/)~~ -- supported once upon a time but the integration is definitely out of date
  * ~~[HappyAccidents](https://www.happyaccidents.ai/)~~ went offline a while back, but the code is still in here -- haven't bothered removing it
  * ~~[Mage.space](https://www.mage.space/)~~ I almost started this once but I never subscribed to the service so I never finished it

## About Taiger's Taigging
Taiger is not about necessarily capturing ALL metadata available for a creation (although it _sort of_ does that, see below)... it's more about boiling whatever metadata there is down to a "lowest common denominator" that has some sort of baseline level of support out there. For this reason, I chose to emulate (fairly closely) the way Automatic1111 embeds metadata into images. You get the full prompt, the negative prompt (if there is one), and the most common parameters popularized by Stable Diffusion (steps, seed, model, etc.).  However, Taiger ALSO saves (alongside the image) a JSON file containing ALL the metadata it found... that will frequently have metadata that was not embedded into the image itself, so those JSON files are good to keep around.

Under the covers, Taiger utilizes the excellent exiftool to actually perform the tagging. This works on Windows (I think it requires exiftool.exe to be in your search path) and I'm in the process of porting it to Mac as well (that probably won't work yet but it should soon).

There is also code in there that can read metadata OUT OF images on disk (again, using exiftool), so it can restructure and modify image metadata too... although most of that code is pretty stale since I haven't been maintaining it much.

## How It Works
You may have noticed above, I said things like it "partially" automates the process... or it "helps to" automate the process. I'll explain what I mean.

The main part of Taiger is a "server" component that is powered by NodeJS, running on your local machine.  The secondary part is a "client" that loads in your browser.
The "client" is very, very basic right now.  It's basically just a web page with 2 things on it:  a big textarea where you can paste JSON (with a "submit" button),
and a running console that describes what the server is doing.

So, the basic process goes...
1. You use whatever service you're using, but you use your browser's debugger to monitor the network traffic
2. When you're doing something like looking at your creations, you filter the network requests to get the "right" requests -- the ones that carry all the metadata for your images
3. You copy that information (for multiple creations at one time) into the Taiger client, and hit submit
4. Taiger parses the metadata for each image, downloads the images, embeds the metadata into them, and saves them on disk for you -- with a naming scheme that lets you keep them organized by date of creation.

This is definitely NOT for the faint of heart ... it still involves spelunking around in your browser debugger.  But it DOES save a tremendous amount of time over, for example, cut-and-paste!  It makes it POSSIBLE to capture, catalog, and back up, image metadata from a variety of sources, in a common format -- something not many tools seem too keen to make possible.  So I use it all the time.

For some services that I use a lot -- like StarryAI -- I have also experimented with creating a custom Chrome extension that lets me download things in a much more point-and-click fashion, without opening the debugger.  That Chrome extension uses Taiger on its back-end to do the downloading and tagging; it just gets whatever it needs to and passes that on to Taiger.  The code for this Chrome extension is not currently included in Taiger, but it might get added in the future. In theory, something like this could also be written for Civitai and/or NightCafe, but I doubt I will ever get around to it.
