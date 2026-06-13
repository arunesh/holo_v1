Goal is to build a web application called Holodeck:

Holodeck presents mathematical concepts in an interactive 3d manner using beautiful animations. We can use the manim (3blue1brown) library which can help create these animations or a suitable JS/TS replacement. While 3blue1brown presents it as a video, this web app delivers it in an interactive experience for learning purposes. The user is able to interact using voice (use elevenlabs apis or a suitable replacement) and the system explains concepts using the appropriate animation supported by an AI backend.

Your goal is to build this system that can be served as a web app. Create a system by which one can generate new holodeck ‘pods’ given a 3blue1brown explainer youtube url (figure out how to summarize it, create animations). Each pod is focussed on a single technical topic similar to a 3blue1brown video, however, it also contains additional structured data to allow for real-time changes to the animation based on user queries apart from the narration sequence as in a video. 
The system shall be backed by an AI LLM such as Anthropic (Fable/Opus) which when appropriately prompted shall “create or run previously created library of animations. 

As a first set of pods we shall focus on transformer llm models.

Example:
GPT-2 model pod: Show the detailed structure of a GPT-2 model, show the workings of different layers as a sample instruction/query passed through. If the user asks, ability to zoom into a layer, attention head, show activations as colors and even down to values (0.2f) if the users asks for this or an explanation requires this. If the user doesn’t interact, the experience is similar to watching the video. 
Finally allow the user to also user cursor keys, mouse etc to zoom/pan into a 3d rendering of the architecture. 


Transformer video: https://www.youtube.com/watch?v=wjZofJX0v4M  You can use https://github.com/yt-dlp/yt-dlp to download the youtube video or another suitable tool 

Create a plan and build the harness needed to execute on this project. 

