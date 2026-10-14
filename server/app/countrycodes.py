"""ISO 3166-1 alpha-2 table with English names, alpha-3 codes and common aliases for the `country:` tag namespace."""

from __future__ import annotations

import re
import unicodedata

_ROWS = """
ad|AND|Andorra
ae|ARE|United Arab Emirates|uae,emirates
af|AFG|Afghanistan
ag|ATG|Antigua and Barbuda|antigua
ai|AIA|Anguilla
al|ALB|Albania|shqiperia
am|ARM|Armenia|hayastan
ao|AGO|Angola
aq|ATA|Antarctica
ar|ARG|Argentina
as|ASM|American Samoa
at|AUT|Austria|osterreich
au|AUS|Australia
aw|ABW|Aruba
ax|ALA|Aland Islands|aland
az|AZE|Azerbaijan|azarbaycan
ba|BIH|Bosnia and Herzegovina|bosnia,bosnia herzegovina
bb|BRB|Barbados
bd|BGD|Bangladesh
be|BEL|Belgium|belgique,belgie
bf|BFA|Burkina Faso
bg|BGR|Bulgaria
bh|BHR|Bahrain
bi|BDI|Burundi
bj|BEN|Benin
bl|BLM|Saint Barthelemy|st barthelemy
bm|BMU|Bermuda
bn|BRN|Brunei|brunei darussalam
bo|BOL|Bolivia
bq|BES|Bonaire, Sint Eustatius and Saba|caribbean netherlands
br|BRA|Brazil|brasil
bs|BHS|Bahamas
bt|BTN|Bhutan
bv|BVT|Bouvet Island
bw|BWA|Botswana
by|BLR|Belarus|byelorussia,belorussia,white russia
bz|BLZ|Belize
ca|CAN|Canada
cc|CCK|Cocos Islands|cocos keeling islands
cd|COD|Democratic Republic of the Congo|dr congo,drc,congo kinshasa,congo democratic republic
cf|CAF|Central African Republic
cg|COG|Republic of the Congo|congo,congo brazzaville,congo republic
ch|CHE|Switzerland|schweiz,suisse,svizzera
ci|CIV|Cote d'Ivoire|ivory coast,cote d ivoire
ck|COK|Cook Islands
cl|CHL|Chile
cm|CMR|Cameroon
cn|CHN|China|prc,peoples republic of china,mainland china
co|COL|Colombia
cr|CRI|Costa Rica
cu|CUB|Cuba
cv|CPV|Cabo Verde|cape verde
cw|CUW|Curacao
cx|CXR|Christmas Island
cy|CYP|Cyprus
cz|CZE|Czechia|czech republic,czech
de|DEU|Germany|deutschland,ger,bundesrepublik deutschland
dj|DJI|Djibouti
dk|DNK|Denmark|danmark
dm|DMA|Dominica
do|DOM|Dominican Republic
dz|DZA|Algeria
ec|ECU|Ecuador
ee|EST|Estonia|eesti
eg|EGY|Egypt
eh|ESH|Western Sahara
er|ERI|Eritrea
es|ESP|Spain|espana
et|ETH|Ethiopia
fi|FIN|Finland|suomi
fj|FJI|Fiji
fk|FLK|Falkland Islands|malvinas
fm|FSM|Micronesia
fo|FRO|Faroe Islands|faroes
fr|FRA|France
ga|GAB|Gabon
gb|GBR|United Kingdom|uk,u k,great britain,britain,gb,england,scotland,wales,northern ireland,united kingdom of great britain and northern ireland
gd|GRD|Grenada
ge|GEO|Georgia|sakartvelo
gf|GUF|French Guiana
gg|GGY|Guernsey
gh|GHA|Ghana
gi|GIB|Gibraltar
gl|GRL|Greenland
gm|GMB|Gambia
gn|GIN|Guinea
gp|GLP|Guadeloupe
gq|GNQ|Equatorial Guinea
gr|GRC|Greece|hellas
gs|SGS|South Georgia and the South Sandwich Islands
gt|GTM|Guatemala
gu|GUM|Guam
gw|GNB|Guinea-Bissau
gy|GUY|Guyana
hk|HKG|Hong Kong
hm|HMD|Heard Island and McDonald Islands
hn|HND|Honduras
hr|HRV|Croatia|hrvatska
ht|HTI|Haiti
hu|HUN|Hungary|magyarorszag
id|IDN|Indonesia
ie|IRL|Ireland|eire,republic of ireland
il|ISR|Israel
im|IMN|Isle of Man
in|IND|India
io|IOT|British Indian Ocean Territory
iq|IRQ|Iraq
ir|IRN|Iran|islamic republic of iran
is|ISL|Iceland|island
it|ITA|Italy|italia
je|JEY|Jersey
jm|JAM|Jamaica
jo|JOR|Jordan
jp|JPN|Japan|nippon
ke|KEN|Kenya
kg|KGZ|Kyrgyzstan|kirghizia,kyrgyz republic,kirgizia
kh|KHM|Cambodia
ki|KIR|Kiribati
km|COM|Comoros
kn|KNA|Saint Kitts and Nevis|st kitts and nevis
kp|PRK|North Korea|korea north,democratic peoples republic of korea,dprk
kr|KOR|South Korea|korea,korea south,korea republic,republic of korea,rok
kw|KWT|Kuwait
ky|CYM|Cayman Islands
kz|KAZ|Kazakhstan
la|LAO|Laos|lao peoples democratic republic
lb|LBN|Lebanon
lc|LCA|Saint Lucia|st lucia
li|LIE|Liechtenstein
lk|LKA|Sri Lanka
lr|LBR|Liberia
ls|LSO|Lesotho
lt|LTU|Lithuania|lietuva
lu|LUX|Luxembourg
lv|LVA|Latvia|latvija
ly|LBY|Libya
ma|MAR|Morocco
mc|MCO|Monaco
md|MDA|Moldova|republic of moldova
me|MNE|Montenegro
mf|MAF|Saint Martin|st martin
mg|MDG|Madagascar
mh|MHL|Marshall Islands
mk|MKD|North Macedonia|macedonia
ml|MLI|Mali
mm|MMR|Myanmar|burma
mn|MNG|Mongolia
mo|MAC|Macao|macau
mp|MNP|Northern Mariana Islands
mq|MTQ|Martinique
mr|MRT|Mauritania
ms|MSR|Montserrat
mt|MLT|Malta
mu|MUS|Mauritius
mv|MDV|Maldives
mw|MWI|Malawi
mx|MEX|Mexico
my|MYS|Malaysia
mz|MOZ|Mozambique
na|NAM|Namibia
nc|NCL|New Caledonia
ne|NER|Niger
nf|NFK|Norfolk Island
ng|NGA|Nigeria
ni|NIC|Nicaragua
nl|NLD|Netherlands|holland,nederland,the netherlands
no|NOR|Norway|norge
np|NPL|Nepal
nr|NRU|Nauru
nu|NIU|Niue
nz|NZL|New Zealand|aotearoa
om|OMN|Oman
pa|PAN|Panama
pe|PER|Peru
pf|PYF|French Polynesia
pg|PNG|Papua New Guinea
ph|PHL|Philippines
pk|PAK|Pakistan
pl|POL|Poland|polska
pm|SPM|Saint Pierre and Miquelon
pn|PCN|Pitcairn Islands|pitcairn
pr|PRI|Puerto Rico
ps|PSE|Palestine|state of palestine,palestinian territories
pt|PRT|Portugal
pw|PLW|Palau
py|PRY|Paraguay
qa|QAT|Qatar
re|REU|Reunion
ro|ROU|Romania
rs|SRB|Serbia|srbija
ru|RUS|Russia|russian federation,rossiya,rossija
rw|RWA|Rwanda
sa|SAU|Saudi Arabia
sb|SLB|Solomon Islands
sc|SYC|Seychelles
sd|SDN|Sudan
se|SWE|Sweden|sverige
sg|SGP|Singapore
sh|SHN|Saint Helena, Ascension and Tristan da Cunha|saint helena
si|SVN|Slovenia|slovenija
sj|SJM|Svalbard and Jan Mayen|svalbard
sk|SVK|Slovakia|slovak republic
sl|SLE|Sierra Leone
sm|SMR|San Marino
sn|SEN|Senegal
so|SOM|Somalia
sr|SUR|Suriname
ss|SSD|South Sudan
st|STP|Sao Tome and Principe
sv|SLV|El Salvador
sx|SXM|Sint Maarten
sy|SYR|Syria|syrian arab republic
sz|SWZ|Eswatini|swaziland
tc|TCA|Turks and Caicos Islands
td|TCD|Chad
tf|ATF|French Southern Territories
tg|TGO|Togo
th|THA|Thailand
tj|TJK|Tajikistan
tk|TKL|Tokelau
tl|TLS|Timor-Leste|east timor
tm|TKM|Turkmenistan
tn|TUN|Tunisia
to|TON|Tonga
tr|TUR|Turkey|turkiye
tt|TTO|Trinidad and Tobago|trinidad
tv|TUV|Tuvalu
tw|TWN|Taiwan|republic of china
tz|TZA|Tanzania
ua|UKR|Ukraine|ukraina
ug|UGA|Uganda
um|UMI|United States Minor Outlying Islands
us|USA|United States|usa,u s,u s a,united states of america,america,us of a,the states
uy|URY|Uruguay
uz|UZB|Uzbekistan
va|VAT|Vatican City|holy see,vatican
vc|VCT|Saint Vincent and the Grenadines|st vincent and the grenadines
ve|VEN|Venezuela
vg|VGB|British Virgin Islands
vi|VIR|U.S. Virgin Islands|us virgin islands
vn|VNM|Vietnam|viet nam
vu|VUT|Vanuatu
wf|WLF|Wallis and Futuna
ws|WSM|Samoa
xk|XKX|Kosovo
ye|YEM|Yemen
yt|MYT|Mayotte
za|ZAF|South Africa
zm|ZMB|Zambia
zw|ZWE|Zimbabwe
"""

_PUNCT = re.compile(r"[^\w\s]")


def _norm(value: str) -> str:
    v = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode().casefold()
    v = _PUNCT.sub(" ", v.replace("'", "").replace(".", " "))
    v = " ".join(v.split())
    return v[4:] if v.startswith("the ") else v


NAMES: dict[str, str] = {}
_LOOKUP: dict[str, str] = {}
for _row in _ROWS.strip().splitlines():
    _p = _row.split("|")
    _code, _a3, _name = _p[0], _p[1], _p[2]
    NAMES[_code] = _name
    for _k in (_code, _a3, _name, *(_p[3].split(",") if len(_p) > 3 else [])):
        _LOOKUP.setdefault(_norm(_k), _code)
# "in" / "no" / "it" style two-letter words are codes already; USSR and the like are deliberately unmapped.

CODES = frozenset(NAMES)


def canonical_country(value: str) -> str | None:
    """ISO 3166-1 alpha-2 (lowercase) for a code, alpha-3, English name or common alias; None when unknown."""
    return _LOOKUP.get(_norm(value))
