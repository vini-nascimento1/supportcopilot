/**
 * Map of Slack emoji shortcodes to unicode emoji characters.
 * This is the fallback map — at runtime, Slack's emoji.list API is
 * fetched and merged with this to also resolve custom workspace emoji.
 */
const FALLBACK_EMOJI_MAP: Record<string, string> = {
  // ── Smileys & People ──────────────────────────────────────────
  "smile": "😄", "smiley": "😃", "grinning": "😀", "blush": "😊", "slight_smile": "🙂",
  "wink": "😉", "heart_eyes": "😍", "kissing_heart": "😘", "kissing": "😗",
  "kissing_smiling_eyes": "😙", "kissing_closed_eyes": "😚", "stuck_out_tongue_winking_eye": "😜",
  "stuck_out_tongue_closed_eyes": "😝", "stuck_out_tongue": "😛", "joy": "😂",
  "laughing": "😆", "sweat_smile": "😅", "rofl": "🤣", "relaxed": "☺️",
  "innocent": "😇", "sunglasses": "😎", "nerd": "🤓", "thinking": "🤔",
  "confused": "😕", "neutral": "😐", "expressionless": "😑", "no_mouth": "😶",
  "grimacing": "😬", "worried": "😟", "frowning": "😦", "anguished": "😧",
  "open_mouth": "😮", "hushed": "😯", "astonished": "😲", "sweat": "😓",
  "disappointed": "😞", "pensive": "😔", "persevere": "😣", "confounded": "😖",
  "tired": "😫", "weary": "😩", "pleading": "🥺", "sob": "😭", "cry": "😢",
  "scream": "😱", "fearful": "😨", "cold_sweat": "😰", "disappointed_relieved": "😥",
  "relieved": "😌", "sleepy": "😪", "sleeping": "😴", "mask": "😷",
  "face_with_thermometer": "🤒", "face_with_head_bandage": "🤕", "nauseated": "🤢",
  "vomiting": "🤮", "sneezing": "🤧", "hot": "🥵", "cold": "🥶", "woozy": "🥴",
  "dizzy_face": "😵", "dizzy": "💫", "star_struck": "🤩", "partying": "🥳", "monocle": "🧐",
  "unamused": "😒", "flushed": "😳", "zipper_mouth": "🤐", "lying": "🤥",
  "shushing": "🤫", "hand_over_mouth": "🤭", "yawning": "🥱", "rolling_eyes": "🙄",
  "triumph": "😤", "rage": "😡", "angry": "😠", "smiling_imp": "😈", "imp": "👿",
  "skull": "💀", "skull_and_crossbones": "☠️", "poop": "💩", "clown": "🤡",
  "ogre": "👹", "goblin": "👺", "ghost": "👻", "alien": "👽", "robot": "🤖",
  "robot_face": "🤖", "alien_monster": "👾", "jack_o_lantern": "🎃",
  "wave": "👋", "raised_hand": "✋", "hand": "✋", "raised_back_of_hand": "🤚",
  "raised_hand_with_fingers_splayed": "🖐️", "spock": "🖖", "ok_hand": "👌",
  "pinched_fingers": "🤌", "pinching": "🤏", "crossed_fingers": "🤞",
  "love_you": "🤟", "metal": "🤘", "call_me": "🤙", "point_left": "👈",
  "point_right": "👉", "point_up": "☝️", "point_down": "👇", "point_up_2": "👆",
  "middle_finger": "🖕", "fu": "🖕",
  "fist": "✊", "punch": "👊", "left_facing_fist": "🤛", "right_facing_fist": "🤜",
  "clap": "👏", "raised_hands": "🙌", "open_hands": "👐", "palms_up": "🤲",
  "handshake": "🤝", "pray": "🙏", "muscle": "💪", "selfie": "🤳",
  "nail_care": "💅", "ear": "👂", "nose": "👃", "eye": "👁️", "eyes": "👀",
  "tongue": "👅", "lips": "👄",
  "baby": "👶", "child": "🧒", "boy": "👦", "girl": "👧", "adult": "🧑",
  "man": "👨", "woman": "👩", "older_adult": "🧓", "older_man": "👴", "older_woman": "👵",
  "person_blond_hair": "👱", "man_blond_hair": "👱‍♂️", "woman_blond_hair": "👱‍♀️",
  "person_red_hair": "🧑‍🦰", "man_red_hair": "👨‍🦰", "woman_red_hair": "👩‍🦰",
  "person_curly_hair": "🧑‍🦱", "man_curly_hair": "👨‍🦱", "woman_curly_hair": "👩‍🦱",
  "person_white_hair": "🧑‍🦳", "man_white_hair": "👨‍🦳", "woman_white_hair": "👩‍🦳",
  "person_bald": "🧑‍🦲", "man_bald": "👨‍🦲", "woman_bald": "👩‍🦲",
  "bearded_person": "🧔", "man_beard": "🧔‍♂️", "woman_beard": "🧔‍♀️",
  "woman_with_headscarf": "🧕", "man_in_suit": "🕴️", "person_in_tuxedo": "🤵",
  "man_in_tuxedo": "🤵‍♂️", "woman_in_tuxedo": "🤵‍♀️", "person_with_veil": "👰",
  "man_with_veil": "👰‍♂️", "woman_with_veil": "👰‍♀️",
  "pregnant_woman": "🤰", "breast_feeding": "🤱",
  "princess": "👸", "prince": "🤴", "mage": "🧙", "fairy": "🧚", "vampire": "🧛",
  "merperson": "🧜", "elf": "🧝", "genie": "🧞", "zombie": "🧟",
  "person_frowning": "🙍", "man_frowning": "🙍‍♂️", "woman_frowning": "🙍‍♀️",
  "person_pouting": "🙎", "man_pouting": "🙎‍♂️", "woman_pouting": "🙎‍♀️",
  "person_gesturing_no": "🙅", "man_gesturing_no": "🙅‍♂️", "woman_gesturing_no": "🙅‍♀️",
  "person_gesturing_ok": "🙆", "man_gesturing_ok": "🙆‍♂️", "woman_gesturing_ok": "🙆‍♀️",
  "person_tipping_hand": "💁", "man_tipping_hand": "💁‍♂️", "woman_tipping_hand": "💁‍♀️",
  "person_raising_hand": "🙋", "man_raising_hand": "🙋‍♂️", "woman_raising_hand": "🙋‍♀️",
  "deaf_person": "🧏", "deaf_man": "🧏‍♂️", "deaf_woman": "🧏‍♀️",
  "person_bowing": "🙇", "man_bowing": "🙇‍♂️", "woman_bowing": "🙇‍♀️",
  "person_facepalming": "🤦", "man_facepalming": "🤦‍♂️", "woman_facepalming": "🤦‍♀️",
  "person_shrugging": "🤷", "man_shrugging": "🤷‍♂️", "woman_shrugging": "🤷‍♀️",
  "health_worker": "🧑‍⚕️", "man_health_worker": "👨‍⚕️", "woman_health_worker": "👩‍⚕️",
  "student": "🧑‍🎓", "man_student": "👨‍🎓", "woman_student": "👩‍🎓",
  "teacher": "🧑‍🏫", "man_teacher": "👨‍🏫", "woman_teacher": "👩‍🏫",
  "judge": "🧑‍⚖️", "man_judge": "👨‍⚖️", "woman_judge": "👩‍⚖️",
  "farmer": "🧑‍🌾", "man_farmer": "👨‍🌾", "woman_farmer": "👩‍🌾",
  "cook": "🧑‍🍳", "man_cook": "👨‍🍳", "woman_cook": "👩‍🍳",
  "mechanic": "🧑‍🔧", "man_mechanic": "👨‍🔧", "woman_mechanic": "👩‍🔧",
  "factory_worker": "🧑‍🏭", "man_factory_worker": "👨‍🏭", "woman_factory_worker": "👩‍🏭",
  "office_worker": "🧑‍💼", "man_office_worker": "👨‍💼", "woman_office_worker": "👩‍💼",
  "scientist": "🧑‍🔬", "man_scientist": "👨‍🔬", "woman_scientist": "👩‍🔬",
  "technologist": "🧑‍💻", "man_technologist": "👨‍💻", "woman_technologist": "👩‍💻",
  "singer": "🧑‍🎤", "man_singer": "👨‍🎤", "woman_singer": "👩‍🎤",
  "artist": "🧑‍🎨", "man_artist": "👨‍🎨", "woman_artist": "👩‍🎨",
  "pilot": "🧑‍✈️", "man_pilot": "👨‍✈️", "woman_pilot": "👩‍✈️",
  "astronaut": "🧑‍🚀", "man_astronaut": "👨‍🚀", "woman_astronaut": "👩‍🚀",
  "firefighter": "🧑‍🚒", "man_firefighter": "👨‍🚒", "woman_firefighter": "👩‍🚒",
  "police_officer": "👮", "man_police_officer": "👮‍♂️", "woman_police_officer": "👮‍♀️",
  "detective": "🕵️", "man_detective": "🕵️‍♂️", "woman_detective": "🕵️‍♀️",
  "guard": "💂", "man_guard": "💂‍♂️", "woman_guard": "💂‍♀️",
  "construction_worker": "👷", "man_construction_worker": "👷‍♂️", "woman_construction_worker": "👷‍♀️",
  "cowboy": "🤠",
  "person_running": "🏃", "man_running": "🏃‍♂️", "woman_running": "🏃‍♀️",
  "person_walking": "🚶", "man_walking": "🚶‍♂️", "woman_walking": "🚶‍♀️",
  "person_standing": "🧍", "man_standing": "🧍‍♂️", "woman_standing": "🧍‍♀️",
  "person_kneeling": "🧎", "man_kneeling": "🧎‍♂️", "woman_kneeling": "🧎‍♀️",
  "person_in_wheelchair": "🧑‍🦽", "man_in_wheelchair": "👨‍🦽", "woman_in_wheelchair": "👩‍🦽",
  "people_holding_hands": "🧑‍🤝‍🧑", "couple": "👫",
  "kiss": "💏", "couplekiss": "💏", "couple_with_heart": "💑",
  "family": "👪",
  "men_holding_hands": "👬", "women_holding_hands": "👭",
  "dancers": "💃", "man_dancing": "🕺",
  "person_in_lotus_position": "🧘", "person_taking_bath": "🛀",
  "person_in_bed": "🛌",

  // ── Hand Gestures ─────────────────────────────────────────────
  "fingers_crossed": "🤞", "vulcan_salute": "🖖",
  "writing_hand": "✍️", "clap_tone2": "👏🏻", "wave_tone2": "👋🏻",

  // ── Hearts ────────────────────────────────────────────────────
  "heart": "❤️", "orange_heart": "🧡", "yellow_heart": "💛", "green_heart": "💚",
  "blue_heart": "💙", "purple_heart": "💜", "brown_heart": "🤎", "black_heart": "🖤",
  "white_heart": "🤍", "red_heart": "❤️",
  "two_hearts": "💕", "revolving_hearts": "💞",
  "sparkling_heart": "💖", "heartpulse": "💗", "heartbeat": "💓", "cupid": "💘",
  "gift_heart": "💝", "broken_heart": "💔",

  // ── Symbols ───────────────────────────────────────────────────
  "100": "💯", "anger": "💢", "boom": "💥", "collision": "💥",
  "sweat_drops": "💦", "dash": "💨", "hole": "🕳️",
  "fire": "🔥", "rocket": "🚀", "star": "⭐", "sparkles": "✨",
  "zap": "⚡", "rainbow": "🌈", "snowflake": "❄️", "sunny": "☀️",
  "thumbsup": "👍", "+1": "👍", "thumbsdown": "👎", "-1": "👎",
  "white_check_mark": "✅", "ballot_box_with_check": "☑️", "heavy_check_mark": "✔️",
  "x": "❌", "red_circle": "🔴", "large_blue_circle": "🔵",
  "large_orange_diamond": "🔶", "large_blue_diamond": "🔷",
  "small_red_triangle": "🔺", "small_red_triangle_down": "🔻",
  "arrow_up": "⬆️", "arrow_down": "⬇️", "arrow_right": "➡️", "arrow_left": "⬅️",
  "arrow_up_down": "↕️", "arrow_backward": "◀️", "arrow_forward": "▶️",
  "warning": "⚠️", "no_entry": "⛔", "no_entry_sign": "🚫",
  "o": "⭕", "m": "Ⓜ️", "tm": "™️", "copyright": "©️", "registered": "®️",
  "atm": "🏧", "wc": "🚾", "parking": "🅿️", "sos": "🆘",
  "id": "🆔", "new": "🆕", "free": "🆓", "abcd": "🔤",
  "abc": "🔤", "capital_abcd": "🔠", "lowercase_abcd": "🔡", "numbers": "🔢",
  "cool": "🆒", "top": "🔝", "end": "🔚", "back": "🔙", "on": "🔛", "soon": "🔜",
  "up": "🆙", "ok": "🆗", "cl": "🆑", "ng": "🆖",
  "vs": "🆚", "zzz": "💤",
  "musical_note": "🎵", "notes": "🎶",
  "radioactive": "☢️", "biohazard": "☣️",

  // ── Objects ───────────────────────────────────────────────────
  "memo": "📝", "pencil": "✏️", "envelope": "✉️", "telephone": "☎️",
  "phone": "☎️",
  "bulb": "💡", "book": "📖", "books": "📚", "mag": "🔍", "mag_right": "🔎",
  "lock": "🔒", "unlock": "🔓", "key": "🔑", "link": "🔗", "clipboard": "📋",
  "pushpin": "📌", "paperclip": "📎", "scissors": "✂️",
  "hammer": "🔨", "wrench": "🔧", "gear": "⚙️", "pick": "⛏️",
  "nut_and_bolt": "🔩", "screwdriver": "🪛",
  "alarm_clock": "⏰", "hourglass": "⌛", "watch": "⌚", "stopwatch": "⏱️",
  "clock": "🕐", "clock1": "🕐", "clock2": "🕑", "clock3": "🕒",
  "clock4": "🕓", "clock5": "🕔", "clock6": "🕕", "clock7": "🕖",
  "clock8": "🕗", "clock9": "🕘", "clock10": "🕙", "clock11": "🕚", "clock12": "🕛",
  "moneybag": "💰", "gem": "💎", "gift": "🎁",
  "tada": "🎉", "confetti": "🎊", "balloon": "🎈", "camera": "📷",
  "camera_with_flash": "📸", "video_camera": "📹", "clapper": "🎬",
  "computer": "💻", "chart": "📊", "calendar": "📅", "tear_off_calendar": "📆",
  "card_index": "📇", "chart_with_upwards_trend": "📈", "chart_with_downwards_trend": "📉",
  "bar_chart": "📊", "page_facing_up": "📄", "page_with_curl": "📃",
  "scroll": "📜", "file_folder": "📁", "open_file_folder": "📂",
  "card_file_box": "🗃️", "briefcase": "💼",
  "seedling": "🌱", "palm_tree": "🌴", "cactus": "🌵", "tulip": "🌷",
  "cherry_blossom": "🌸", "rose": "🌹", "sunflower": "🌻", "four_leaf_clover": "🍀",
  "maple_leaf": "🍁", "mushroom": "🍄", "earth": "🌍",
  "earth_americas": "🌎", "earth_asia": "🌏", "moon": "🌙",
  "full_moon": "🌕", "new_moon": "🌑", "waxing_crescent_moon": "🌒",
  "first_quarter_moon": "🌓", "waxing_gibbous_moon": "🌔",
  "waning_gibbous_moon": "🌖", "last_quarter_moon": "🌗", "waning_crescent_moon": "🌘",
  "crescent_moon": "🌙", "new_moon_with_face": "🌚", "full_moon_with_face": "🌝",
  "star2": "🌟", "stars": "🌠", "sunrise": "🌅", "sunrise_over_mountains": "🌄",
  "ocean": "🌊", "drop": "💧", "droplet": "💧",

  // ── Animals ───────────────────────────────────────────────────
  "dog": "🐶", "cat": "🐱", "fox": "🦊", "bear": "🐻",
  "panda": "🐼", "koala": "🐨", "lion": "🦁", "pig": "🐷", "frog": "🐸",
  "monkey": "🐵", "monkey_face": "🐵", "chicken": "🐔", "bird": "🐦", "penguin": "🐧",
  "butterfly": "🦋", "snail": "🐌", "bee": "🐝", "honeybee": "🐝", "fish": "🐟", "octopus": "🐙",
  "dog2": "🐕", "poodle": "🐩", "wolf": "🐺", "cat2": "🐈",
  "lion_face": "🦁", "tiger": "🐯", "tiger2": "🐅", "leopard": "🐆",
  "horse": "🐴", "horse_racing": "🏇", "unicorn": "🦄", "zebra": "🦓",
  "deer": "🦌", "cow": "🐮", "ox": "🐂", "water_buffalo": "🐃", "cow2": "🐄",
  "ram": "🐏", "sheep": "🐑", "goat": "🐐", "llama": "🦙",
  "elephant": "🐘", "rhinoceros": "🦏", "hippopotamus": "🦛",
  "mouse": "🐭", "mouse2": "🐁", "rat": "🐀", "hamster": "🐹",
  "rabbit": "🐰", "rabbit2": "🐇", "chipmunk": "🐿️", "hedgehog": "🦔",
  "bat": "🦇", "eagle": "🦅", "duck": "🦆", "swan": "🦢", "owl": "🦉",
  "peacock": "🦚", "parrot": "🦜", "lizard": "🦎", "turtle": "🐢",
  "snake": "🐍", "dragon": "🐉", "dragon_face": "🐲",
  "whale": "🐳", "whale2": "🐋", "dolphin": "🐬", "shark": "🦈",
  "blowfish": "🐡", "tropical_fish": "🐠", "shell": "🐚",
  "coral": "🪸", "crab": "🦀", "lobster": "🦞", "shrimp": "🦐", "squid": "🦑",
  "bug": "🐛", "ant": "🐜", "mosquito": "🦟", "cockroach": "🪳",
  "spider": "🕷️", "spider_web": "🕸️", "scorpion": "🦂",
  "microbe": "🦠", "dna": "🧬",

  // ── Science & Technology ──────────────────────────────────────
  "test_tube": "🧪", "petri_dish": "🧫",
  "microscope": "🔬", "telescope": "🔭", "satellite": "🛰️",
  "satellite_orbital": "🛰️", "compass": "🧭",
  "joystick": "🕹️", "flashlight": "🔦", "electric_plug": "🔌",
  "battery": "🔋", "light_bulb": "💡",

  // ── Food & Drink ──────────────────────────────────────────────
  "apple": "🍎", "pear": "🍐", "tangerine": "🍊", "orange": "🍊",
  "mandarin": "🍊", "lemon": "🍋", "banana": "🍌",
  "watermelon": "🍉", "grapes": "🍇", "strawberry": "🍓", "cherries": "🍒",
  "peach": "🍑", "mango": "🥭", "pineapple": "🍍", "avocado": "🥑",
  "eggplant": "🍆", "potato": "🥔", "carrot": "🥕", "corn": "🌽",
  "cucumber": "🥒", "broccoli": "🥦", "garlic": "🧄", "onion": "🧅",
  "bread": "🍞", "cheese": "🧀", "pizza": "🍕", "hamburger": "🍔", "fries": "🍟",
  "hotdog": "🌭", "sandwich": "🥪", "taco": "🌮", "burrito": "🌯",
  "dumpling": "🥟", "egg": "🥚", "fried_egg": "🍳", "cooking": "🍳",
  "pancakes": "🥞", "waffle": "🧇", "bacon": "🥓",
  "spaghetti": "🍝", "ramen": "🍜", "stew": "🍲", "curry": "🍛",
  "sushi": "🍣", "rice": "🍚", "rice_ball": "🍙", "rice_cracker": "🍘",
  "oden": "🍢", "dango": "🍡",
  "bento": "🍱", "sake": "🍶", "wine_glass": "🍷",
  "coffee": "☕", "tea": "🍵", "beer": "🍺", "beers": "🍻", "cocktail": "🍸",
  "tropical_drink": "🍹", "champagne": "🥂", "champagne_glass": "🥂",
  "cup_with_straw": "🥤", "popcorn": "🍿", "icecream": "🍦",
  "ice_cream": "🍨", "shaved_ice": "🍧", "cake": "🎂",
  "birthday": "🎂", "candy": "🍬", "chocolate": "🍫", "lollipop": "🍭",
  "honey_pot": "🍯", "cookie": "🍪", "fortune_cookie": "🥠",
  "takeout_box": "🥡", "chopsticks": "🥢",
  "bowl_with_spoon": "🥣", "green_salad": "🥗",
  "canned_food": "🥫", "salt": "🧂",

  // ── Activities & Sports ───────────────────────────────────────
  "soccer": "⚽", "basketball": "🏀", "football": "🏈", "baseball": "⚾",
  "softball": "🥎", "volleyball": "🏐", "tennis": "🎾",
  "badminton": "🏸", "ping_pong": "🏓", "field_hockey": "🏑", "ice_hockey": "🏒",
  "cricket": "🏏", "golf": "⛳", "archery": "🏹", "boxing_glove": "🥊",
  "martial_arts_uniform": "🥋", "fencing": "🤺",
  "skateboard": "🛹", "roller_skate": "🛼", "sled": "🛷",
  "ice_skate": "⛸️", "ski": "🎿", "snowboarder": "🏂",
  "surfer": "🏄", "rowboat": "🚣", "swimmer": "🏊", "bicyclist": "🚴",
  "mountain_bicyclist": "🚵", "person_biking": "🚴", "person_mountain_biking": "🚵",
  "trophy": "🏆", "medal": "🏅", "military_medal": "🎖️",
  "first_place": "🥇", "second_place": "🥈", "third_place": "🥉",
  "running_shirt": "🎽", "lacrosse": "🥍",
  "dart": "🎯", "bowling": "🎳", "slot_machine": "🎰",
  "game_die": "🎲", "jigsaw": "🧩", "chess_pawn": "♟️",

  // ── Travel & Places ───────────────────────────────────────────
  "airplane": "✈️", "airplane_departure": "🛫", "airplane_arrival": "🛬",
  "helicopter": "🚁", "train": "🚃", "railway_car": "🚃", "train2": "🚆",
  "metro": "🚇", "bus": "🚌", "trolleybus": "🚎", "minibus": "🚐",
  "ambulance": "🚑", "fire_engine": "🚒", "police_car": "🚓", "taxi": "🚕",
  "car": "🚗", "red_car": "🚗", "truck": "🚚", "tractor": "🚜",
  "bike": "🚲", "scooter": "🛴", "motor_scooter": "🛵",
  "motorcycle": "🏍️", "race_car": "🏎️",
  "anchor": "⚓", "ship": "🚢", "sailboat": "⛵", "canoe": "🛶",
  "flying_saucer": "🛸",
  "construction": "🚧", "fuelpump": "⛽", "busstop": "🚏",
  "vertical_traffic_light": "🚦", "traffic_light": "🚥",
  "station": "🚉", "mountain_railway": "🚞", "monorail": "🚝",
  "bullettrain_side": "🚄", "bullettrain_front": "🚅",
  "house": "🏠", "house_with_garden": "🏡", "office": "🏢",
  "post_office": "🏣", "hospital": "🏥", "bank": "🏦",
  "hotel": "🏨", "church": "⛪", "mosque": "🕌", "synagogue": "🕍",
  "stadium": "🏟️", "school": "🏫", "factory": "🏭",
  "japan": "🗾", "mountain": "⛰️", "volcano": "🌋", "beach": "🏖️",
  "desert": "🏜️", "island": "🏝️", "camping": "🏕️",
  "tent": "⛺", "foggy": "🌁", "city_sunset": "🌇", "city_sunrise": "🌇",
  "night_with_stars": "🌃", "bridge_at_night": "🌉",
  "milky_way": "🌌", "fireworks": "🎆", "sparkler": "🎇",

  // ── Flags ─────────────────────────────────────────────────────
  "checkered_flag": "🏁", "triangular_flag_on_post": "🚩",
  "crossed_flags": "🎌", "black_flag": "🏴", "white_flag": "🏳️",
  "rainbow_flag": "🏳️‍🌈", "transgender_flag": "🏳️‍⚧️",
  "pirate_flag": "🏴‍☠️",
  "flag_br": "🇧🇷", "flag_us": "🇺🇸", "flag_gb": "🇬🇧",
  "flag_fr": "🇫🇷", "flag_de": "🇩🇪", "flag_it": "🇮🇹",
  "flag_es": "🇪🇸", "flag_pt": "🇵🇹", "flag_jp": "🇯🇵",
  "flag_cn": "🇨🇳", "flag_in": "🇮🇳", "flag_mx": "🇲🇽",
  "flag_ca": "🇨🇦", "flag_au": "🇦🇺", "flag_nl": "🇳🇱",
  "flag_be": "🇧🇪", "flag_ch": "🇨🇭", "flag_se": "🇸🇪",
  "flag_no": "🇳🇴", "flag_dk": "🇩🇰", "flag_fi": "🇫🇮",
  "flag_pl": "🇵🇱", "flag_ru": "🇷🇺", "flag_kr": "🇰🇷",
  "flag_ar": "🇦🇷", "flag_co": "🇨🇴", "flag_cl": "🇨🇱",
  "flag_ie": "🇮🇪", "flag_il": "🇮🇱", "flag_ng": "🇳🇬",
  "flag_za": "🇿🇦", "flag_eg": "🇪🇬", "flag_tr": "🇹🇷",
  "flag_gr": "🇬🇷", "flag_th": "🇹🇭", "flag_vn": "🇻🇳",

  // ── Nature ────────────────────────────────────────────────────
  "sun_with_face": "🌞", "cloud": "☁️", "umbrella": "☂️",
  "cyclone": "🌀", "fog": "🌫️", "wind": "🌬️",
  "tornado": "🌪️", "rain_cloud": "🌧️", "snow_cloud": "🌨️",
  "lightning": "🌩️",
  "blossom": "🌼", "hibiscus": "🌺",
  "bouquet": "💐", "wilted_flower": "🥀", "white_flower": "💮",
  "herb": "🌿", "evergreen_tree": "🌲", "deciduous_tree": "🌳",
  "leaves": "🍃", "fallen_leaf": "🍂",

  // ── Clothing & Accessories ────────────────────────────────────
  "eyeglasses": "👓", "dark_sunglasses": "🕶️", "goggles": "🥽",
  "lab_coat": "🥼", "safety_vest": "🦺", "necktie": "👔",
  "shirt": "👕", "jeans": "👖", "dress": "👗", "kimono": "👘",
  "sari": "🥻", "swimwear": "🩱", "briefs": "🩲", "shorts": "🩳",
  "bikini": "👙", "womans_clothes": "👚",
  "purse": "👛", "handbag": "👜", "pouch": "👝", "shopping_bags": "🛍️",
  "school_satchel": "🎒", "thong_sandal": "🩴",
  "mans_shoe": "👞", "athletic_shoe": "👟", "hiking_boot": "🥾",
  "high_heel": "👠", "sandal": "👡", "boot": "👢",
  "crown": "👑", "tophat": "🎩", "mortar_board": "🎓",
  "military_helmet": "⛑️", "rescue_worker_helmet": "⛑️",
  "prayer_beads": "📿", "lipstick": "💄", "ring": "💍",

  // ── Music, Arts & Hobbies ────────────────────────────────────
  "headphones": "🎧", "microphone": "🎤", "guitar": "🎸", "violin": "🎻",
  "drum": "🥁", "trumpet": "🎺", "saxophone": "🎷",
  "musical_keyboard": "🎹", "accordion": "🪗",
  "art": "🎨", "palette": "🎨", "thread": "🧵", "yarn": "🧶",
  "sewing_needle": "🪡", "knot": "🪢",

  // ── Special ───────────────────────────────────────────────────
  "heart_hands": "🫶",
  "anatomical_heart": "🫀", "lungs": "🫁",
  "bubbles": "🫧",
  "rock": "🪨", "wood": "🪵", "hut": "🛖",
  "mirror": "🪞", "window": "🪟",
  "plunger": "🪠", "mouse_trap": "🪤", "bucket": "🪣",
  "toothbrush": "🪥", "soap": "🧼", "tooth": "🦷", "bone": "🦴",
}

/** Type representing an emoji map entry — unicode char or custom image URL. */
export type EmojiEntry = string

/** Type for the full emoji map (shortcode → unicode char or image URL). */
export type EmojiMap = Record<string, EmojiEntry>

/**
 * Replace Slack emoji shortcodes (`:emoji:`) with unicode emoji characters
 * or custom emoji `<img>` tags. Accepts an optional dynamic map (fetched
 * from Slack's emoji.list) which is merged with the built-in fallback map.
 */
export function parseSlackEmojis(text: string, dynamicMap?: EmojiMap): string {
  if (!dynamicMap) {
    return text.replace(/:([a-z0-9_+\-]+):/gi, (match, name) => {
      return FALLBACK_EMOJI_MAP[name.toLowerCase()] ?? match
    })
  }

  // Merge dynamic + fallback (dynamic takes precedence)
  const merged: EmojiMap = { ...FALLBACK_EMOJI_MAP, ...dynamicMap }

  return text.replace(/:([a-z0-9_+\-]+):/gi, (match, name) => {
    const val = merged[name.toLowerCase()]
    if (!val) return match
    // Custom emoji — Slack returns an image URL for workspace-uploaded emoji
    if (val.startsWith("http")) {
      return `<img src="${val}" alt=":${name}:" class="inline-block size-4 align-middle rounded-sm" />`
    }
    return val
  })
}

/**
 * Build a permalink to a specific Slack message.
 */
export function getMessagePermalink(
  workspaceUrl: string,
  channelId: string,
  ts: string
): string {
  const tsClean = ts.replace(".", "")
  return `${workspaceUrl}/archives/${channelId}/p${tsClean}`
}
