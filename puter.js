import { puter } from '@heyputer/puter.js';


puter.ai.chat(`Why did the chicken cross the road?`, {
            model: 'gpt-5-nano',
        }).then(puter.print);