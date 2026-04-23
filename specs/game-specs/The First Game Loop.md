Overview:
Players will initially have only a single button to begin progressing through the game with. When pressed, the button should have a light feedback, such as depressing. Players begin with a resource bar showing an icon for "Scrap", 0 at first, and incrementing each time the button is pressed. The icon for scrap should disperse from the button on click, and lerp to the resource tally, adding to the total. This initial button can be called "Scavenge", and it will be upgradable using the Scrap resource, increasing the amount of scrap obtained with each button press.

User Story:
A new user is presented with the most basic form of the games mechanics, which is incrementing resources to be used for upgrades and future gameplay systems.

Requirements:
+ Server authoritative processes, the button will eventually have synchronous, immediate affects on other users within the games party, guild, or location systems.

Extensibility:
At first the user is generating a very small amount of resources, but after scaling up, it's possible the user will be creating millions of scrap per click. The animation showing scrap flowing from the button to the resource bar should be scalable. For example, you could increase the size of the scrap icon to represent a power of 10, and round to prevent on screen clutter from getting excessive.