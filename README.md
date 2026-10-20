# iPad Werkplek

Aparte statische PWA met WerkHub, AI Hub, schrijven, werkmappen en Drive-back-up.
Geen build-stap. PDF.js staat lokaal; Google Identity Services wordt alleen online
geladen wanneer je Google Drive bewust koppelt.
Doelapparaat: iPad Air 5, opgegeven iPadOS 26.5.2, ESR GEO Digital Pencil.
Dit is een eerste prototype, niet het volledige integratieproject.

## Starten

Serveer deze map via een lokale HTTP-server en open `index.html` op localhost.
Publicatie via HTTPS is nodig om op de iPad de offline service worker te gebruiken.
De eerste versie is door Remy gepubliceerd op https://remyster.github.io/ipad-werkplek/.
Versie 2 moet als complete set app-assets worden geupload; publicatie is niet automatisch.
De app gebruikt alleen relatieve assetpaden en kan onder een GitHub Pages-subpad draaien.

## Wat werkt

- Meerdere schriftbladen en whiteboards; titel en getypte tekst naast penstreken.
- Vaste werkmappen: DWAT/AKF, LWS, Billa / Meeting, UF-RO, Overveen, Waag, PWN Guidelines, PWN Contacten en Routes en Opleidingen / Cursus.
- Compacte pictogrammenbalk direct boven het canvas, met pen, dikke stift, markeerstift, twee gummen, vrije lasso, vormen, kleur en dikte.
- Lokaal bewaren, opnieuw openen, JSON-back-up downloaden en echte Google Drive-back-up/herstel via OAuth.
- Offline app-shell na een geslaagde eerste online installatie.
- WerkHub-taken, standaard geopende WerkHub en AI Hub, Google Calendar-weergave en beveiligde AI-chat.
- Canvas met twee lagen: opgeslagen penstreken en alleen nieuwe live-penpunten.
- Brede schrijfmodus zonder zijbalk, inklapbare documenten en getypte notities.
- Lokale invoermeter: pen/touch/muis, genegeerde invoer en onderbrekingen.

Een schriftblad toont een pagina van 800 x 1120 teken-eenheden. De pagina is een
visuele achtergrond, geen harde grens. Een whiteboard heeft geen paginagrens.
De app bewaakt maximaal 1.000.000 penpunten over alle documenten. Een penpunt is één ontvangen positie tijdens een streek, niet één zichtbaar stipje. Afgeronde streken worden vereenvoudigd om minder punten op te slaan. De grens is alleen een veiligheidsstop; de beschikbare browseropslag kan al eerder vol raken, dus grote borden blijven back-ups nodig hebben.

## Beperkingen en gegevens

Notities worden eerst in localStorage op het apparaat en de browser opgeslagen.
Google Drive-back-up is bewust en handmatig, geen automatische live synchronisatie.
Drive maakt een zichtbaar JSON-back-upbestand met PDF-bijlagen in de map
`Remy iPad Werkplek`; via Herstel geselecteerde back-up kun je dezelfde Werkplek
op een pc of ander apparaat terugzetten. Wis geen browsergegevens voordat je een
lokale of Drive-back-up hebt gecontroleerd.
Opslagfouten worden getoond; ongeldige bestaande opslag wordt niet overschreven.
De browser kan gegevens wissen. Een geinstalleerde webapp is geen back-upgarantie.

Geen API-sleutels of Google-toegangstokens in localStorage. Het openbare Google
OAuth client-ID mag lokaal worden onthouden; het tijdelijke toegangstoken blijft
alleen in geheugen.
Google is de opgegeven provider voor zowel werk als prive. Werktoestemming moet
worden gecontroleerd voordat een echte kalenderkoppeling wordt ingeschakeld.
Haiku-modelkeuze voor de latere backend: `claude-haiku-5-5`; beschikbaarheid in het
uiteindelijke API-account moet bij aansluiten worden getest.

De ESR-pen kan door de browser als touch in plaats van pen worden gemeld.
Daarom staat aanraking tekenen standaard aan, met een uitschakeloptie.
Drukgevoeligheid, handpalmherkenning en Apple Scribble zijn niet gegarandeerd.
Tekenmodus accepteert maar een actieve pointer. Een herkende pen krijgt voorrang op
een nog niet opgeslagen touch-streek; die touch-streek vervalt om handpalminkt te vermijden.
Touch kan een actieve herkende pen niet overnemen. Twee touch-bronnen kunnen niet
betrouwbaar als ESR-pen en handpalm worden onderscheiden; er is geen handpalmgarantie.
Remy bevestigt dat ESR niet tekent met touch uit, maar wel goed werkt in Freeform.
Zoom gebruikt knoppen of twee vingers (pinch-zoom).
Een onderbroken penstreek wordt bewaard voor zover de browser de pointer-events heeft geleverd.
Diagnosewaarden blijven alleen in het geheugen van de pagina, zonder coordinaten,
netwerkverkeer of opslag. De Canvas-laag gebruikt maximaal 2x schermresolutie.
Het opslagformaat en de localStorage-sleutel blijven gelijk: oude notities blijven leesbaar.

De offline-cache heeft versienummer v21. De nieuwe worker activeert na volledige
assetinstallatie. Een melding vraagt om handmatig herladen; geen automatische reload
tijdens schrijven. Upload alle assets samen. Wis geen websitegegevens om te updaten.

## Controle

Serveer de map via HTTP en open `tests.html`. Die pagina controleert modelvalidatie,
coordinaten, zoom, foutgevallen, de editor en opnieuw laden in een iframe.
De suite controleert ook penprioriteit, touchblokkering, annulering, het laatste
penpunt, Canvas-pixels, incrementeel tekenen, minimale focusafmetingen,
de actieve service worker en de zeven offline shell-assets.
De tests gebruiken een afzonderlijke testopslag in geheugen en verwijderen geen notities.
Voer browsertests op een leeg, apart browserprofiel uit; de iframecontrole schrijft
proefnotities in de app-opslag van dat profiel.
De suite is geen vervanging voor fysieke pen-, handpalm- en iPadOS-tests.

Versie 2 gecontroleerd op 2026-10-12 in een apart Chrome-profiel:
alle 46 browsertests geslaagd. De brede schrijfmodus gebruikt in de test minimaal
95% van de schermbreedte en 60% van de schermhoogte. Bij 100 gesimuleerde
penbewegingen worden opgeslagen streken niet opnieuw getekend; alleen de nieuwe
streek wordt aan het einde toegevoegd. Live pixels zijn na animation frames
gecontroleerd, terwijl de opgeslagen tekenlaag ongewijzigd blijft.
Ook werkelijk offline heropenen gecontroleerd via uitgeschakeld browsernetwerk:
app-shell geladen, opgeslagen document hersteld, geen appfout.
Deze checks meten geen fysieke ESR-latentie of betrouwbare handpalmherkenning.
Headless virtual-time tests zijn niet geschikt voor de service-workerinstallatie;
gebruik echte browsertijd voor de volledige suite.

## Versie 2 uploaden en testen

Pak `../ipad-werkplek-v2-upload.zip` uit en upload de bestanden in de hoofdmap
van dezelfde repository. Vervang de bestaande app-assets, niet je notitieopslag.
Na GitHub Pages-deployment open je de site online. Bij de updatemelding herlaad
je na afronden van de penstreek. Wis geen browsergegevens. Download voor de
zekerheid eerst een notitieback-up in de oude app.

Open Schrijven, kies Brede schrijfmodus en schrijf eerst zonder hand op het scherm.
Open vervolgens Peninstellingen & invoermeter, schrijf met de ESR en meld
Laatste invoer (pen/touch) en Onderbroken. Vergelijk daarna met hand op het scherm.
Schrift en whiteboard gebruiken dezelfde invoerengine.

## Versie 3: gerichte invoerdiagnose

Remy bevestigt: ESR werkt met lichte druk en hand op het scherm goed in Freeform.
In de webproef komt peninvoer binnen, maar schrijven met handpalm blijft slecht.
Versie 3 is een meetversie, geen bewezen oplossing voor dit fysieke probleem.
Upload de uitgepakte assets uit `../ipad-werkplek-v3-upload.zip` naar dezelfde
repository en herlaad na de nieuwe service-workerinstallatie (cache v3).

In Peninstellingen & invoermeter maakt Start nieuwe meting de tellers leeg,
zonder notities te verwijderen. De laatste vijf afgeronde teken- of panbewegingen
tonen ontvangen pointermove-events, samples (inclusief down/up), behouden
tekenpunten, duur, grootste ontvangstgat en eindreden. Eindredenen omvatten
pointerup, pointercancel, lostpointercapture, vervangen door pen, bediening,
formaatwijziging en pagina verlaten/verborgen. Alleen vluchtig paginageheugen:
geen coordinaten, notitietekst, opslag of netwerkverkeer in de diagnose.
Het paneel wordt niet bij elke penbeweging aangepast, om de meting niet met
onnodig UI-werk te belasten. Tijdens een meting verschijnt de samenvatting
bij het einde van de streek.

Tijdgaten meten ontvangsttijd op de hoofddraad, niet de hardware-samplefrequentie.
Een gat kan een echte pauze, browservertraging of ontbrekende events zijn;
deze getallen bewijzen niet zelfstandig dat invoer wordt gemist.
Geen drukdrempel toegevoegd. Meer druk is geen aanbevolen oplossing.

Test met touch uit: reset, schrijf drie korte woorden zonder hand, bewaar een
screenshot van alleen de meter. Reset en herhaal met hand. Vergelijk de laatste
streken en geef aan of de zichtbare lijnen ontbreken of vertraagd verschijnen.
53 browsertests geslaagd op 2026-10-12, inclusief nuldruk, telwaarden, eindredenen,
begrensde historie, reset zonder dataverlies en een werkelijk gemeten tijdgat.
Ook echt offline heropenen met behoud van bestaande notities is gecontroleerd.

## Volgende bouwstap

Eerst de schrijfproef op de echte iPad beoordelen. Vervolgens gedeelde gegevensopslag,
authenticatie, herstel/import, WerkHub-taken, AI Hub-projecten, Google OAuth en een
beveiligde Haiku-backend aansluiten. Bestaande apps en live data blijven ongewijzigd
tot de wijziging is voorgelegd en bevestigd.

## Versie 4: selectie en directe inkt

Remy's v3-test zonder hand: pen 12, touch 0, geen genegeerde of geannuleerde
contacten, grootste ontvangstgaten 24-27 ms, laatste vijf eindredenen pointerup.
Toch ontbrekende lijnen en onbedoelde paginatekstselectie met kopieermenu.
Die fysieke waarneming is niet verklaard door de eenvoudige tellers.

Versie 4 blokkeert tekstselectie in de schrijfsectie en native touch-defaults
op het canvas via niet-passieve listeners, ook naast Pointer Events.
Titel, notitievelden en documentkeuze behouden hun gewone tekstbediening.
Een nieuwe canvas-aanraking verwijdert bestaande selectie en verlaat een actief
tekstveld zodat de pen niet tegelijk in dat veld blijft werken.
Dit is geen garantie voor alle iPadOS-systeemmenu's; Safari moet fysiek worden getest.

Live-inkt wordt nu direct in de pointermove-handler getekend, zonder op een
animation frame te wachten. Alle verschillende ontvangen coordinaten worden
behouden, ook bewegingen kleiner dan de oude 0.3-pixelgrens. Bij gebundelde
events wordt een afwijkend eindpunt van het hoofd-event eveneens verwerkt.
De bestaande limiet van 100.000 punten blijft gelden, en kan eerder bereikt worden.
Geen voorspelde of verzonnen penpunten en geen drukdrempel.

59 Chrome-browsertests geslaagd op 2026-10-12, inclusief selectie-eventpreventie,
tekstvelden, onmiddellijke inktpixels en exacte gebundelde penpunten.
Echte offline heropening en behoud van oude notities gecontroleerd.
Deze tests reproduceren niet Safari's echte lang-indrukmenu of ESR-hardware.

Upload de uitgepakte assets uit `../ipad-werkplek-v4-upload.zip`; cacheversie v4.
Herlaad na de updatemelding, zonder browsergegevens te wissen.
Controleer de zichtbare v4-label. Test eerst zonder hand en met touch uit:
een langzame doorlopende lijn en enkele woorden. Meld of het kopieermenu terugkomt
en of ontbrekende lijnstukken blijven. Pas daarna opnieuw met hand testen.

## Versie 5: gum, doorschuiven en extra schriftpagina's

- Gum (hele streek) verwijdert de volledige geraakte penstreek, geen stukje ervan.
  De gum heeft een raakafstand van 12 schermpixels plus de halve lijndikte.
  Ook snelle bewegingen die een streek kruisen worden geraakt.
- Ongedaan/Opnieuw ondersteunt zowel tekenen als gummen. Nieuwe wijzigingen
  wissen de redo-tak. Maximaal 50 undo-acties in paginageheugen; documentwissel
  en herladen wissen die historie, maar niet de opgeslagen penstreken.
  Na herladen kan Ongedaan nog de laatst opgeslagen streek verwijderen.
- Aanraking tekenen staat standaard uit, passend bij Remy's bevestigde peninvoer.
  Vingerbewegingen schuiven dan het canvas; de pen schrijft of gumt.
  Een actieve pen wordt niet overgenomen door touch. Een pen die tijdens een
  vingerschuif start krijgt voorrang en herstelt de viewport van voor die schuif.
  Dit is geen harde garantie tegen onbedoelde verschuiving door een handpalm
  wanneer er geen actieve pen is. Verplaatsen blijft ook als apart gereedschap.
- Een schrift heeft pagina's onder elkaar (800 x 1120 met 24 eenheden ertussen).
  Pagina erbij verlengt hetzelfde document en springt naar de nieuwe pagina.
  Vorige/Volgende pagina en een teller maken navigatie zichtbaar.
  Er kunnen maximaal 200 pagina's per schrift zijn. Dit vergroot de bestaande
  limiet van 100.000 penpunten niet. Pagina-achtergronden worden alleen voor het
  zichtbare gebied getekend; een whiteboard heeft geen paginagrens.
- Muisscroll/trackpad-wheel schuift eveneens het schrijfgebied.

Oude documenten zonder pages-veld blijven leesbaar als eenpagina-documenten.
Penstreken en tekst worden niet gemigreerd of aangepast. Nieuwe paginatelling
wordt bij toevoegen lokaal opgeslagen en opgenomen in de JSON-back-up.
Gummen verandert je lokale notitie alleen door de expliciete gumhandeling.

73 Chrome-browsertests geslaagd op 2026-10-12: gum-hitdetectie, volledige herstel-
en redo-controle, paginaschrijven, navigatie, touch-scroll zonder inkt,
penprioriteit, behoud bij herladen en echte offline heropening.
Safari/ESR en handpalmgedrag moeten op de echte iPad worden getest.
Upload `../ipad-werkplek-v5-upload.zip`, herlaad na installatie van cache v5.
Controleer het label Versie 5. Wis geen browsergegevens.

WerkHub-, AI Hub-, agenda- en Haiku-datakoppelingen blijven de volgende fase.
Remy's akkoord om daarmee verder te gaan is vastgelegd; deze versie bevat nog
alleen de bestaande links, geen nieuwe datakoppelingen of backend.

## Versie 6: WerkHub-taken lezen en AI Hub openen

Laad open taken leest maximaal 100 niet-afgeronde work_tasks, met titel, status,
project en deadline. Alleen GET; geen nieuwe taken, statuswijzigingen of logboeken.
De bestaande WerkHub-login wordt gebruikt uit werkhub_auth op dezelfde origin.
Er staat geen wachtwoordveld in deze app. Een afwezige of verlopen sessie verwijst
naar WerkHub; deze koppeling roteert geen gedeelde refresh-tokens.
Supabase-toegangsregels blijven leidend en zijn niet via deze app gecontroleerd.

Open eerst WerkHub en Werkplek in dezelfde Safari-browser (beide remyster.github.io).
Log in bij WerkHub zelf, ga terug en klik Laad open taken. Afzonderlijke
beginscherm-webapps kunnen verschillende opslag hebben; gedeelde login daarin
is niet gegarandeerd. Voor betrouwbare zelfstandige login volgt later een aparte
geauthenticeerde integratie. Geen tokens of wachtwoorden in chat delen.

De publieke SB_URL/SB_KEY-config wordt op verzoek gelezen uit de bestaande
WerkHub-HTML. Alleen de vastgepinde database en publieke anon/publishable sleutel
worden geaccepteerd; gewijzigde broncode/config geeft een expliciete fout.
Dit is een tijdelijke compatibiliteitsadapter, geen stabiele gedeelde config-API.
Het lokale bronpatroon is gecontroleerd, echte accounttoegang nog niet getest.
Een latere gedeelde connector vereist afstemming met de bestaande hubs.

Taken blijven in paginageheugen, niet in de notitiedatabase of offline-cache.
Verberg taken wist de weergave en voorkomt dat een lopende aanvraag ze weer toont.
Pagina verlaten of een gewijzigd loginrecord in een andere tab wist de lijst.
API-responses zijn no-store. Notities worden niet naar de database gestuurd.
Het iframe opent alleen na een klik en gebruikt de bestaande AI Hub met eigen
opslag, login en externe diensten. Browser/hosting kan inbedden blokkeren;
Open AI Hub blijft beschikbaar. Sluiten verwijdert de bron van het iframe.
Geen automatische overdracht van notities of nieuwe Haiku-aanroepen toegevoegd.

88 Chrome-browsertests geslaagd met uitsluitend fictieve taken en loginfixtures,
plus echte offline heropening. Onder andere GET-only, verlopen sessie, verkeerd
datamodel, weigeren private key, tekstveilige titels en verbergen tijdens aanvraag.
Live taaktoegang en iPad-iframegedrag zijn nog niet geverifieerd.
Upload `../ipad-werkplek-v6-upload.zip` (nu negen bestanden met connections.js),
herlaad na de updatemelding. Cacheversie v6. Niet alleen de oude acht bestanden
uploaden: connections.js is nodig voor deze koppeling.

Agenda OAuth, nieuwe Haiku-backend en gedeelde AI Hub-project-API zijn nog open.
Gebruik bestaande providers en geef interne werkgegevens alleen door via
goedgekeurde diensten. Er is geen backendsecret nodig voor deze leesversie.

## Versie 7: gedeeltelijke gum, pagina leegmaken en tweevingerzoom

De gum verwijdert nu alleen de geraakte stukken inkt. Penstreken worden exact
geknipt tegen de capsule van de gumbeweging; resterende stukken blijven bewaard
als aparte penstreken. Ook punten en snelle kruisende gumbewegingen werken.
Undo/redo bewaart een hele gumhandeling, ook als het aantal streken niet verandert.
Een verkeerd geneste helper in de vorige lokale code is hierbij rechtgezet:
gum- en geschiedenishelpers zijn nu toegankelijk vanuit alle invoerhandlers.

Pagina leegmaken vraagt bevestiging. Een schrift wist alleen penstreekdelen
binnen de huidige pagina (800 x 1120); inkt op andere pagina's, de tussenruimte,
tekst en paginatelling blijven bestaan. Op een whiteboard wordt alle inkt gewist.
Ongedaan kan de actie herstellen tijdens dezelfde documentsessie.
Schrijven buiten de getekende paginagrens blijft mogelijk en wordt niet gewist
door Pagina leegmaken. Maak eerst een back-up van belangrijke notities.

Twee touch-pointers starten pinch-zoom (0.2x-4x) en verplaatsen het middelpunt.
Een eventueel nog niet opgeslagen vingerpenstreek vervalt bij starten van pinch.
Een actieve herkende pen krijgt voorrang: twee vingers of handpalmen starten dan
geen zoom. Touch-tekenen aan betekent inderdaad dat een vinger ook kan tekenen;
uit betekent dat een vinger schuift. iPad-handpalmgedrag nog fysiek controleren.

Taken: live WerkHub-configpatronen en publicatie van connections.js zijn gecontroleerd,
maar er zijn geen echte taken of loginrecords opgevraagd. WerkHub binnen deze app
opent nu een loginpaneel op dezelfde origin, in dezelfde appcontext. Log daar in
en klik daarna Laad open taken. Dit omzeilt niet de serverrechten en belooft
geen werkende login als Safari of de hub iframe-login blokkeert. De bestaande
WerkHub-link blijft bruikbaar. Bij een fout de exacte zichtbare melding melden,
zonder tokens/wachtwoorden. Task-authenticatie zelf is ongewijzigd gebleven.
Het AI Hub-iframe is van de schrijfrubriek naar het juiste hubtabblad verplaatst.

Google Calendar-widget: een ingebouwde agendaweergave naast de externe link.
Vul lokaal een agenda-ID in uit Google Calendar Instellingen > betreffende
agenda > Agenda integreren. Optioneel een tweede ID voor werk/prive samen.
Geen geheime ICS-URL invullen en geen privéagenda openbaar maken.
De iframe-weergave hangt af van Google-login en browser-cookiebeleid; een
lege/geblokkeerde widget is niet opgelost door deze UI. Echte OAuth-gebaseerde
private agenda-integratie is nog niet gebouwd. De IDs staan alleen in de pagina
en iframe-URL, worden niet automatisch lokaal opgeslagen. Google ontvangt de
ingestelde IDs pas na klikken op Toon agenda-widget. Verbergen laadt het iframe uit.
Dit is een webwidget binnen Werkplek, geen iPadOS-beginschermwidget.

Versie 7: 99 Chrome-browsertests geslaagd, inclusief exacte deelsplitsing,
pagina-clear met annuleren/undo, tweevingerzoom met en zonder vingertekenen,
iframeplaatsing, veilige kalender-URL en bestaande fictieve-data-taaktests.
Ook echt offline heropenen met behouden notities gecontroleerd.
Geen echte Supabase-login of Google-agendatoegang getest.
Upload `../ipad-werkplek-v7-upload.zip` (negen appbestanden), cacheversie v7.
Herlaad na deployment en updatemelding, zonder browsergegevens te wissen.

## Versie 8: pen- en gumkeuze, bewaren duidelijker

Gumgrootte: radius 6/12/24/40 schermpixels (diameter 12/24/48/80).
De gekozen radius wordt bij start van een gumhandeling vastgezet en omgerekend
naar canvas-eenheden, zodat de gum op het scherm dezelfde maat heeft bij zoomen.
Penbreedte instelbaar 1-20 teken-eenheden met zichtbare waarde.
Pensoorten: ronde pen, fineliner (rechte lijnuiteinden) en stippellijn.
Dit zijn weergavestijlen, geen simulatie van vulpen/drukgevoelige kalligrafie.
Nieuwe streken bewaren brush en width; oude zonder brush blijven ronde pen.
Gumfragmenten behouden de penseigenschappen van de originele streek.

Bewaar schrift/bord schrijft dezelfde lokale opslag als automatisch bewaren.
Bladen & back-up bevat alle eerder gemaakte schriften en borden. Een nieuw
document voegt toe, vervangt niet. Geen cloudsync of herstelinterface toegevoegd.
103 Chrome-tests geslaagd inclusief elk penseel, breedte per streek, gummaat en
exact behoud van een oud document bij nieuw schrift. Echte offline heropening
met behoud van notities opnieuw gecontroleerd.
Upload `../ipad-werkplek-v8-upload.zip`; alle negen assets, cacheversie v8.

## Open werk na versie 8

PDF in whiteboard met schrijven erop/ernaast is gevraagd maar nog niet gebouwd.
Dit vraagt PDF-rendering naar een verplaatsbare documentlaag, opslag van het
origineel en de annotaties, en een back-up die ook PDF-bestanden omvat.
Alleen een PDF in een iframe tonen voldoet niet: daarop kan het canvas niet tekenen.
Bestandsopslag moet van localStorage naar een passende binaire opslag uitgebreid
worden, zonder bestaande notities te verliezen. Geen privé-PDF naar een online
conversiedienst uploaden. Eerst een proef met een openbaar of leeg PDF-bestand.

Remy meldt dat Toon agenda-widget niet werkt. De oorzaak is niet vastgesteld.
Vraag de exacte zichtbare fout/status (geen privéafspraken), niet meer agenda-ID's
of geheime links. Voor betrouwbare private kalenderweergave is Google OAuth nodig;
die providerconfiguratie is nog niet geregeld.
AI Hub kan al binnen de app via de hubtab geopend worden. Project-API,
Haiku-backend en handschriftomzetting zijn nog niet aangesloten.
Echte WerkHub-taaktoegang blijft ongeverifieerd tot login/foutmelding beoordeeld is.

## Versie 9: lokale PDF op whiteboard

Inclusief alle pen/gumkeuzes uit versie 8. Open een whiteboard zonder PDF en
kies PDF op whiteboard. Maximaal een bestand per bord, 20 MB en 10 pagina's.
Alle pagina's worden 800 teken-eenheden breed onder elkaar geplaatst.
De PDF is een vaste achtergrond: erover en ernaast schrijven werkt; afzonderlijk
slepen, herschalen of verwijderen van het PDF-object is nog niet toegevoegd.
Zoom/pan verplaatst PDF en inkt samen. Gum en Pagina leegmaken wijzigen uitsluitend
inkt; het originele PDF en de achtergrond blijven intact.
Pagina leegmaken betekent op whiteboard alle inkt, niet het PDF-bestand.

PDF.js 6.4.299 (npm pdfjs-dist, Apache-2.0) draait volledig lokaal. De runtime,
worker, fonts, CMaps, WASM, ICC en bijbehorende licenties staan in vendor/package.
Er worden geen PDF's naar een externe dienst verstuurd; embedded PDF-scripts
worden niet uitgevoerd. Wachtwoord-PDF's en ongeldige bestanden geven een fout.
Hoogte/breedteverhouding boven 5 wordt geweigerd om extreme bitmapgroottes te vermijden.

IndexedDB bewaart het originele bestand en gerenderde PNG-pagina's.
localStorage bewaart zoals eerder de notities plus een PDF-verwijzing.
Download originele PDF bewaart het ongewijzigde bestand.
Download back-up bevat nu ook originele PDF's en pagina-afbeeldingen als data-URLs.
Back-ups kunnen daardoor groot worden. Een herstel/importinterface voor deze
back-ups is nog niet gebouwd; geen volledig herstelproces of cloudback-up beloven.
Browsergegevens wissen verwijdert zowel notities als PDF's. Begin met een
onbelangrijk voorbeeldbestand en bewaar originelen ook buiten de app.
Herhaalde imports of verlaten borden kunnen ongebruikte PDF-bestanden achterlaten
in de lokale opslag; automatische opschoning is bewust nog niet toegevoegd.

Offline openen van eerder geimporteerde documenten werkt zonder opnieuw
PDF.js te renderen. Nieuwe offline import kan extra fonts nodig hebben die
nog niet gecachet zijn; niet elke PDF is offline importeerbaar.
Runtime/worker zitten in de offline shell; opgevraagde vendor-assets worden gecachet.

109 Chrome-browsertests geslaagd op 2026-10-12, met echte PDF.js-import van een
zelf gegenereerde openbare proef-PDF, binaire opslag, tekenen erop/ernaast,
origineelbehoud, complete export, fout bij niet-PDF en PDF-herstel na herladen.
Werkelijk offline heropenen met oude notities gecontroleerd. iPad Safari,
grote/complexe PDF's en bedrijfsdocumenten zijn niet getest.

Upload `../ipad-werkplek-v9-upload.zip`, inclusief de complete vendor-map.
Alleen de oude negen losse bestanden uploaden is onvoldoende; pdf.js en de
vendor-bestanden zijn nodig. Laat de mapstructuur intact, cacheversie v9.
Het pakket bevat uitsluitend appcode en leveranciersruntime, geen proefnotities
of geimporteerde documenten.

## Versie 10: grotere werkvlakken

De dubbele WerkHub- en schriftkaarten onder Een rustige start zijn verwijderd.
De agendakaart gebruikt daardoor de volledige beschikbare breedte. De taken en
ingebouwde WerkHub blijven daaronder staan. Agendaweergave is 75% viewporthoogte
(minimaal 520 px), WerkHub en AI Hub 90% (minimaal 600 px).
Het schrijfvlak is buiten focus 85% viewporthoogte, ook op smalle schermen.
De brede schrijfmodus klapt de pen/gum/pagina-instellingen dicht; via de summary
kunnen ze weer geopend worden. Geen peninvoerlogica of opgeslagen notities gewijzigd.

PDF-import accepteert nu maximaal 50 pagina's per bestand, nog steeds maximaal
20 MB en een PDF per whiteboard. Dit vervangt de versie-9-limiet van 10 pagina's.
Alle pagina's liggen onder elkaar; vingerschuif en zoom geven toegang tot de
onderste pagina's en de ruimte ernaast. Het whiteboard had al onbegrensde
pan-coordinaten; een groter zichtbaar venster verandert niet de opslaglimieten.
Pagina's achteraf vanuit een tweede PDF toevoegen of losse PDF-objecten bewegen
is nog niet ondersteund. Schriften houden maximaal 200 eigen pagina's.

123 Chrome-browsertests geslaagd, inclusief echte PDF.js-rendering van 50 pagina's
en expliciete afwijzing van 51, grotere viewports, ingeklapte focus-tools en
behoud van bestaande notities. Geen fysieke iPad-test van deze nieuwe layout.

### AI-paneel

Eigen tab Claude & Gemini binnen Werkplek, geen ingesloten Claude/Gemini-website.
Ondersteunt directe Anthropic API, Gemini API en OpenRouter via een beveiligde
backend. Providerkeys horen uitsluitend in backendsecrets. Het feit dat iemand
al API-toegang heeft configureert of financiert deze koppeling niet automatisch.
De backend moet apart worden gepubliceerd en toegestane gebruiker/model/secrets
moeten worden ingesteld. Tot dat moment is de chat niet live bruikbaar.

Alleen expliciet ingevoerde openbare/fictieve tekst mag na toestemming worden
verstuurd. Geen schriften, PDF's, WerkHub-taken of PWN-notities automatisch naar
AI sturen. Geen chatgeschiedenis in lokale opslag. Dit is tekstchat, niet
handschriftherkenning of toegang tot VS Code-agents. AI-antwoorden wijzigen
geen notities of taken en blijven te controleren voorstellen.
Providerrequestvormen, user-allowlist, origincontrole en bodylimiet zijn met
fictieve requests getest tegen de echte backendbron. Geen live providerverzoek,
Deno typecheck of Supabase deployment uitgevoerd; die runtimevalidatie blijft
nodig voor activatie. Zie backend/README.md voor inrichting.
Het v10-updatepakket bevat geen vendor-bestanden: de reeds geuploade vendor-map
blijft staan. Pak het updatepakket in Codespaces uit; publiceer alleen app-assets,
niet de ZIP en niet backend als onderdeel van een frontend-upload.

## Versie 11: snel AI-venster bij het schrijven

Vraag aan AI opent bij schrift en whiteboard een compact Claude-dialoogvenster.
De knop blijft zichtbaar in brede schrijfmodus. Alleen de expliciet getypte
vraag wordt na toestemming verstuurd via dezelfde beveiligde backend; geen
blad, afbeelding, PDF, titel of opgeslagen tekst wordt meegestuurd.
Verder schrijven (of Escape) sluit het venster zonder tabwissel, zoomwijziging
of verlies van inkt. Een reeds verzonden vraag kan nog kosten veroorzaken:
sluiten annuleert de providerverwerking niet. Late antwoorden verschijnen niet
in een later geopend venster. Vraag, antwoord en toestemming worden bij sluiten
gewist uit het venster, niet als chatgeschiedenis opgeslagen.

Voeg antwoord toe bewaart uitsluitend na die klik een tekstblok in het actieve
document. Dit vervangt voor deze knop de v10-regel dat antwoorden nooit notities
wijzigen. De oorspronkelijke penstreken en PDF blijven intact. Tekst verschijnt
bij de zichtbare linkerbovenhoek, onder eventuele tekstblokken op dezelfde plek.
Het blok beweegt en zoomt mee met het blad en wordt opgenomen in JSON-back-ups.
Maximaal 100 blokken per document, elk 20.000 tekens. Lange tekst kan buiten de
getekende schriftpagina doorlopen: verschuif het schrijfgebied om verder te lezen.
Blokken zijn geen handschrift en worden niet door de inktgum of Pagina leegmaken
gewist. Ze zijn nog niet versleepbaar of bewerkbaar. Ongedaan/Opnieuw ondersteunt
toevoegen binnen dezelfde documentsessie; herladen/documentwissel wist de historie.
Oude documenten zonder textBlocks blijven leesbaar. Opslagfouten melden expliciet
dat toevoegen is mislukt en draaien de nieuwe toevoeging terug.

144 Chrome-browsertests geslaagd, waaronder toestemming, geen automatische
opslag, beide documenttypen, echte tekstpixels, toevoegen/undo/redo, late antwoorden,
herladen, oude inkt en offline PDF. Geen live Claude-verzoek of fysieke iPad-test
uitgevoerd. Handschriftherkenning/afbeeldinginvoer blijft nog niet aangesloten.
Upload de elf app-assets uit ../ipad-werkplek-v11-update.zip met de bestaande
vendor-map behouden; backendcode en secrets hoeven voor deze UI-update niet te
veranderen. Herlaad na de updatemelding, zonder browsergegevens te wissen.

## Versie 12: Gemini handschriftherkenning

Herken handschrift opent hetzelfde kleine venster, voor schrift en whiteboard
en ook in brede schrijfmodus. In een lokaal voorbeeld selecteer je met pen of
vinger een rechthoek; Selecteer alle zichtbare inkt is het toetsenbordalternatief.
Schuif of zoom je blad eerst naar het gewenste stukje. Alleen zichtbare peninkt
wordt op wit papier gerenderd: geen PDF-achtergrond, paginalijnen, getypte tekst,
titel, eerdere gesprekken of WerkHub-data. Een nieuwe selectie vereist opnieuw
toestemming. Het exacte bijgesneden beeld is zichtbaar voordat je Herken klikt.

De PNG wordt lokaal verkleind tot maximaal 1600 pixels per zijde, maximaal 2 MB.
Lege/onzichtbare selectie wordt expliciet geweigerd. Alleen na selectie EN
toestemming EN verzenden gaat het beeld naar de bestaande Supabase-functie en
rechtstreeks naar Gemini. Geen OpenRouter-sleutel nodig.
Gemini krijgt een vaste transcriptie-opdracht: oorspronkelijke taal, namen,
getallen en eenheden behouden, geen opdrachten in het beeld uitvoeren, geen
woorden verzinnen of stilzwijgend verbeteren; onzekerheden als [onleesbaar].
Dit blijft AI-uitvoer: correcte herkenning of instructievolging is niet gegarandeerd.
Afgebroken modeloutput wordt als fout gemeld in plaats van een volledig
transcript te suggereren.

Je kunt de herkende tekst controleren en aanpassen in het venster. Alleen
Voeg antwoord toe bewaart die gecontroleerde tekst als nieuw lokaal tekstblok.
Dat verandert de oorspronkelijke inkt niet. Nieuwe blokken komen onder
bestaande inkt/tekst in dezelfde kolom zodat die leesbaar blijft; indien nodig
verschuift het blad naar de toevoeging. Lange tekst kan doorlopen buiten een
schriftpagina. Ongedaan/Opnieuw herstelt de toevoeging binnen dezelfde sessie.
Sluiten wist selectie en transcript uit het venster en invalideert late antwoorden,
maar annuleert reeds gestarte providerverwerking/kosten niet. Geen beeldopslag in
localStorage, IndexedDB, back-up of service-worker-cache. De provider kan eigen
bewaartermijnen hanteren. Gebruik uitsluitend openbare/fictieve gegevens, geen
interne PWN-notities, persoonsgegevens, logins of meetgegevens.

179 Chrome-browsertests plus echte offline PDF-heropening geslaagd. Getest:
beide schrijfvlakken, daadwerkelijke rechthoekselectie, PNG/pixelgrenzen,
uitsluiten echte PDF-achtergrond/getypte blokken, toestemming, Gemini-inlineData,
auth/allowlist, ontbrekende secrets, ongeldige/te grote afbeeldingen, afgebroken
modeloutput, handschriftbehoud, gecorrigeerde tekst/undo/redo/herladen.
Providerreacties zijn mocks: live herkenningskwaliteit, kosten, echte
Supabase-runtime en fysieke iPad zijn niet geverifieerd.

Inrichten:
1. Upload de elf assets uit ../ipad-werkplek-v12-update.zip met bestaande vendor.
2. Zet in Supabase Edge Functions > Secrets GEMINI_API_KEY en GEMINI_MODEL.
   Gebruik voor deze versie gemini-2.5-pro, modelcode gecontroleerd op 2026-10-12:
   https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro .
   Sleutel alleen via Supabase-dashboard, nooit chat/code/git.
3. Vervang in de bestaande functie werkplek-ai de volledige code door
   backend/supabase/functions/werkplek-ai/index.ts en deploy opnieuw. Oude v10
   backend ondersteunt geen afbeeldingen. Bestaande Claude-, origin- en
   userallowlist-secrets blijven staan. Geen SQL/databasewijzigingen.
4. Herlaad de app en test eerst een kort openbaar/fictief woord; controleer het
   transcript voordat je het toevoegt. Geen browsergegevens wissen.

## Versie 13: mappen, getypte meetlijsten en werkbeschrijvingen

Schrijven is uitgebreid tot een lokale werkmap. Je kunt zelf mappen aanmaken en
ieder schrift, whiteboard, meetlijst of PDF-bord aan een map koppelen. Nieuwe
documenten nemen de map van het geopende document over. Bestaande versie-1-data
zonder mappen blijft geldig en wordt niet verwijderd. Mappen en plaatsing zitten
in dezelfde JSON-back-up als de overige documentgegevens.

Nieuwe DWAT/AKF- en LWS-meetlijsten zijn volledig typbaar. DWAT/AKF bevat
bezoekgegevens, de vijf bemonsteringspunten uit de aangeleverde meetstaat,
meetwaarden per punt, waterdebietmeters en aantekeningen. LWS bevat
bezoekgegevens, weer, sensorstatus, rondecontroles en observaties. Invoer wordt
automatisch lokaal opgeslagen. Dit is geen wijziging van een bronlogboek en geen
cloudkoppeling. Controleer codes, locaties en werkwijze tegen de geldende
gecontroleerde PWN-bron voordat deze formulieren als officieel logboek worden
gebruikt.

Werkbeschrijving als nieuw PDF-bord importeert een PDF als zelfstandig whiteboard
in de huidige map. De bestaande grenzen blijven gelden: maximaal 20 MB en 50
pagina's, met het origineel en de gerenderde pagina's alleen in lokale
browseropslag. Je kunt er met pen overheen en ernaast schrijven. De PDF zit ook
in de handmatige JSON-back-up.

195 Chrome-browsertests geslaagd, inclusief oude opslag, mappen, beide meetlijsten,
apart PDF-bord, pen/gum/zoom, AI-regressies en offline app-shell. Fysieke bediening
op de iPad en gebruik als officieel PWN-logboek zijn nog niet bevestigd.
Upload de elf app-assets uit `../ipad-werkplek-v13-update.zip` en behoud de
bestaande vendor-map. Herlaad na de updatemelding; wis geen browsergegevens.

## Versie 14: vaste werkmappen, minder knoppen en echte Drive-back-up

DWAT/AKF en LWS zijn geen knoppen meer die telkens een nieuwe lijst maken.
Elke knop opent een vaste map met één herbruikbare meetstatus. Na overname in
het officiële logboek wist `Meetlijst leegmaken` na bevestiging alle ingevulde
velden en vinkjes. Eerdere dubbele meetlijsten worden niet verwijderd; bestaande
versie-13-lijsten worden naar de juiste vaste map verplaatst en blijven bewaard.

Vaste mapknoppen:

- DWAT/AKF en LWS
- Billa / Meeting, UF-RO, Overveen en Waag
- PWN Guidelines, PWN Contacten en Routes en Opleidingen / Cursus

Een lege algemene vaste map krijgt bij de eerste opening één notitieblad. Een
nieuw schrift, whiteboard of PDF-bord neemt de map van het geopende document
over. `Nieuwe eigen map` maakt een map met een eerste notitieblad. De werkmap-UI
is gegroepeerd in Werkmappen, Nieuw of toevoegen en Schrijven en AI.

WerkHub en AI Hub worden standaard geladen. Bij een geldige bestaande
WerkHub-sessie worden open taken automatisch opgehaald; anders blijft het
loginpaneel direct beschikbaar.

### Google Drive eenmalig instellen

1. Schakel in een eigen Google Cloud-project de Google Drive API in.
2. Maak een OAuth 2.0-client van type Web application. Voeg
   `https://remyster.github.io` toe als Authorized JavaScript origin. Gebruik
   voor lokale tests ook de exacte lokale origin. Stel zo nodig Remy's
   Google-account in als testgebruiker.
3. Open Werkmap > Inhoud & back-up, vul uitsluitend het openbare client-ID
   (`...apps.googleusercontent.com`) in en kies Koppel Google Drive.

Er is geen client secret of API-key nodig en die mogen niet in de app of chat.
De app vraagt alleen de scope `drive.file`. Daarmee maakt en beheert zij uitsluitend
de map en bestanden die zij zelf in Google Drive heeft aangemaakt. `Maak
Drive-back-up` schrijft een zichtbaar JSON-bestand naar `Remy iPad Werkplek`.
Op de pc open je dezelfde webapp, koppelt hetzelfde Google-account, kiest een
back-up en gebruikt Herstel geselecteerde back-up. Herstel vervangt lokale
Werkplekgegevens pas na bevestiging; maak bij twijfel eerst een lokale export.

De Drive-API is met gemockte Google-responses getest; een live OAuth-koppeling
kan pas na het instellen van het openbare client-ID worden bevestigd. Fysieke
iPadbediening en officiële inzet van de PWN-meetlijsten blijven te controleren.
De volledige Chrome-regressie bevat 206 geslaagde controles, inclusief oude
opslag, vaste mappen, herbruikbare meetlijsten, Drive-upload/download,
PDF-herstel, standaard hubs, peninvoer, AI en de offline-cache/foutmelding.
De lokale Windows-Chrome gaf bij een schoon profiel een interne Cache Storage-fout;
versie 14 houdt de online app en PDF-import dan werkend en toont dit expliciet.
Echte offline heropening was in eerdere versies bewezen, maar moet voor v14 nog
eenmaal fysiek op de iPad worden gecontroleerd.
Upload de twaalf assets uit `../ipad-werkplek-v14-update.zip` en behoud de
bestaande vendor-map. Herlaad na de updatemelding en wis geen browsergegevens.

## Versie 15: directe mapwissel en compacte back-up

De dubbele mapkeuze onder `Titel` is verwijderd. Een vaste werkmapknop opent nu
direct het bestaande document of de herbruikbare meetlijst uit die map. De
gekozen map wordt op de knop gemarkeerd. Nieuwe documenten blijven de geopende
map overnemen.

Onder de drie hoofdblokken staat één uitklapbaar blok `Inhoud & back-up`.
Daarin staan de documentlijst en `Download lokale back-up`. De Google
Drive-instellingen, Drive-back-up en herstelkeuze zitten samen in een tweede,
compact uitklapbaar blok. Hierdoor blijft het schrijfvlak rustig wanneer
back-upfuncties niet nodig zijn.

205 Chrome-regressiecontroles geslaagd, inclusief directe werkmapwissel,
afwezigheid van de dubbele mapselector, lokale en Drive-back-up, PDF-herstel,
oude opslag, meetlijsten, peninvoer en offline-fallback. Upload de twaalf assets
uit `../ipad-werkplek-v15-update.zip` en behoud de bestaande vendor-map.

## Versie 16: vaste agenda, duidelijke opslag en compacte bediening

De agenda-instellingen bewaren nu zowel de namen als de Google agenda-ID's in
lokale browseropslag. `Toon agenda-widget` slaat de vier velden op. Bij een
volgende opening wordt een geldige opgeslagen agenda automatisch opnieuw
getoond. Een agenda-ID is geen wachtwoord; gebruik nooit een geheime ICS-link.

De schrijfsectie toont voortaan expliciet `Automatisch opslaan aan` en heeft een
knop `Nu opslaan`. Alle schrijf-, formulier- en titelwijzigingen bleven al direct
lokaal opgeslagen; de knop geeft nu ook een zichtbaar tijdstip ter controle.
`Nieuw of toevoegen` en `Schrijven en AI` gebruiken compacte ronde acties.

De Werkplek heeft een lokaal gemaksslot met code 2109. Dit houdt toevallige
meekijkers tegen, maar de code staat noodzakelijk in de openbare PWA-bron en is
dus geen beveiliging voor vertrouwelijke gegevens. Gebruik daarnaast altijd de
iPad-toegangscode en de echte WerkHub-/AI-login. Wachtwoorden worden niet in de
Werkplek opgeslagen of automatisch ingevuld. Bestaande geldige sessies van de
hubs worden wel automatisch hergebruikt en beide hubs blijven standaard open.

Voor Google Drive kan het openbare OAuth client-ID eenmalig in `config.js` bij
`googleDriveClientId` worden gezet. Het openbare client-ID is op 14 oktober 2026
ingesteld. Dit is uitsluitend openbare configuratie:
plaats hier nooit een client secret, API-key, wachtwoord of toegangstoken.

208 Chrome-regressiecontroles geslaagd. Upload de veertien assets uit
`../ipad-werkplek-v16-update.zip` en behoud de bestaande vendor-map.

## Versie 17: negen ronde acties op een rij

De uitklapmenu's `Nieuw of toevoegen` en `Schrijven en AI` zijn vervallen. De
negen acties staan nu als ronde knoppen naast elkaar, direct boven de
statusregel en het werkvlak: Schrift, Bord, Map, PDF op bord, PDF nieuw, AI
vragen, Handschrift herkennen, PDF downloaden en Brede schrijfmodus. Er hoeft
niets meer open- of dichtgeklapt te worden om een actie te starten.

De knop voor de brede schrijfmodus houdt zijn ronde opmaak in beide standen.
Eerder werd het volledige label in de knop gezet waardoor de tekst uit het
rondje liep; nu wisselt alleen het kleine onderschrift tussen `Breed` en
`Terug`, terwijl titel en voorleeslabel de hele uitleg houden. De rij blijft ook
in de brede schrijfmodus zichtbaar, zodat terugkeren altijd mogelijk is.

Gemeten op iPad-breedte (820 px): negen rondjes van 78 px op een rij, geen
overlopende labels. De rij breekt nooit af: de rondjes krimpen mee met de
schermbreedte tot minimaal 46 px, en past het geheel dan nog niet, dan schuift
de rij horizontaal mee. Ook op telefoonformaat (390 px) staan alle negen
rondjes dus op een rij.

211 Chrome-regressiecontroles geslaagd. Upload de veertien assets uit
`../ipad-werkplek-v17.1-update.zip` en behoud de bestaande vendor-map.

## Versie 18: inhoud per map boven de titel

De inhoudskeuze staat niet meer in het back-upmenu. Direct boven `Titel` staan
nu twee compacte keuzelijsten: eerst de werkmap en daarna alleen de schriften,
borden, PDF-borden en meetlijsten uit die map. De regel `Nu open` toont steeds
de actuele map en inhoud, zodat zichtbaar blijft waar je werkt. De laatst
geopende inhoud blijft lokaal geselecteerd.

`Weggooien` verwijdert na een duidelijke bevestiging het volledige actieve
schrift, bord of meetformulier. Een gekoppeld lokaal PDF-bestand wordt daarna
ook uit de PDF-opslag verwijderd. Als het laatste document wordt weggegooid,
maakt de app automatisch een leeg schrift zodat de lokale opslag geldig blijft.

Het back-upmenu bevat voortaan alleen de lokale download en Google Drive. De
twee PDF-acties heten nu `Achtergrond` (PDF op het huidige lege bord) en
`Nieuw bord` (apart PDF-bord in de huidige map). De invoermeter blijft
beschikbaar voor storingscontrole, maar staat gesloten onder
`Extra: aanraking & pencontrole`; dagelijks gebruik heeft hem niet nodig.

De knop `Nu opslaan` voert nu daadwerkelijk direct een opslagactie uit en toont
het tijdstip. 214 Chrome-regressiecontroles geslaagd. Cache v18. Upload de
veertien assets uit `../ipad-werkplek-v18-update.zip` en behoud de bestaande
vendor-map.

## Versie 19: rustige agenda en vaste WerkHub

De agenda-acties staan direct bij de agenda: `Toon widget`, `Google Calendar
openen` en `Weg`. Alleen de naam- en ID-velden blijven onder
`Agenda-widget instellen`. Opgeslagen agenda-ID's en automatisch heropenen zijn
ongewijzigd.

De losse takenlijst en knoppen voor laden, verbergen en inloggen zijn verwijderd.
WerkHub zelf opent bij iedere start standaard in het ingebouwde paneel. Daar staat
alleen `Sluit WerkHub`; na sluiten opent het paneel weer bij de volgende appstart.
De onderliggende alleen-lezen taakparser blijft beschikbaar voor compatibiliteit,
maar wordt niet meer door de interface aangeroepen.

De Chrome-regressiesuite is na deze wijziging volledig geslaagd. Cache v19.
Upload de veertien assets uit `../ipad-werkplek-v19-update.zip` en behoud de
bestaande vendor-map.

## Versie 20: grote borden, gereedschappen, selectie en PDF-bibliotheek

De oude grens van 100.000 penpunten is vervangen door een veiligheidsgrens van
1.000.000 punten. Nieuwe vrije penstreken worden na afronden geometrisch
vereenvoudigd, met behoud van begin- en eindpunt. Tijdens tekenen blijft alleen
de nieuwe streek live; bij opnieuw tekenen worden alleen streken en PDF-pagina's
in het zichtbare gebied gerenderd. Gumbewegingen worden per animation frame
samengevoegd. Dit vermindert vertraging, maar extreem grote localStorage-
documenten blijven begrensd door de browseropslag. Maak dus nog steeds back-ups.

Nieuwe tekengereedschappen:
- stift en transparante markeerstift;
- lijn, pijl, rechthoek/vierkant en cirkel/ovaal;
- pictogramstempels voor vinkje, waarschuwing en ster;
- gewone gum voor gedeelten en `Kras weg` voor complete geraakte handschriftstreken; vormen blijven bij doorkrassen intact;
- vrije lasso: omcirkel zelf inkt en versleep, kopieer, knip of plak de selectie;
- lang indrukken op een stil punt van het schrijfvlak opent een compact palet
  voor pen, fineliner, stippellijn, stift, markeerstift, gum, kleur en dikte.

De PDF-bibliotheek toont alle lokaal verwerkte PDF-bestanden uit IndexedDB.
Een bestand kan opnieuw als apart bord in de huidige map worden geopend of als
origineel worden gedownload. Een bord weggooien verwijdert het gedeelde
PDF-bestand daarom niet meer stilzwijgend uit de bibliotheek.

`Herken` maakt nu een begrensd beeld van alle peninkt op het blad of whiteboard,
niet alleen de huidige viewport. PDF-achtergrond en getypte tekst blijven buiten
het beeld. Bij `AI Vraag` kan de gebruiker expliciet aanvinken dat Gemini alle
peninkt als context mag lezen. Het beeld wordt tot maximaal 1600 px verkleind,
toestemming blijft verplicht en de backend behandelt tekst in het beeld als
onbetrouwbare inhoud, niet als instructie.

De bestaande opslag blijft versie 1 en oude documenten blijven geldig. De
uitbreiding voegt alleen optionele brush- en shape-waarden toe. In v20.3 staat
de compacte pictogrammenbalk direct boven het canvas, gebruikt Stift standaard
10 px en Markeer standaard 22 px met transparant geel, en is selectie een vrije
lasso in plaats van een rechthoek. 228 lokale Chrome-regressiecontroles geslaagd.
Cache v21. Upload de vijftien app-assets uit
`../ipad-werkplek-v20.3-update.zip`, behoud de bestaande vendor-map en deploy
daarnaast de actuele backend uit `../ipad-werkplek-v20.2-backend.zip`. Echte
iPad-prestaties en live Gemini-herkenning moeten daarna nog fysiek worden
gecontroleerd met uitsluitend fictieve tekst.

## Versie 20.4: Ongedaan terug in de balk, automatisch doorkrassen, gum met cirkel

- Ongedaan en Opnieuw staan nu als grote knoppen in de pictogrammenbalk, dus ook
  zichtbaar in brede schrijfmodus (daar was de oude Ongedaan-knop verborgen).
- Doorkrassen wist automatisch: met Pen, Stift of Fineliner snel heen en weer
  krabbelen over een letter of woord (minimaal vijf banen langs dezelfde hoofdrichting).
  De krabbel zelf wordt niet bewaard; de inkt eronder verdwijnt in een Ongedaan-stap.
  Korte streken verdwijnen helemaal, een lange streek die er doorheen loopt wordt
  alleen binnen het krabbelvak afgeknipt. Vormen en markeerstift blijven staan.
  Een krabbel waaronder geen inkt staat blijft gewone inkt. Uitzetten kan onder
  Extra: aanraking & pencontrole > Doorkrassen wist automatisch.
- Gum toont een cirkel op de gumgrootte rond de pen. In brede schrijfmodus is de
  gumgrootte nu zichtbaar zodra Gum actief is. Een tweede aanraking (handpalm) midden
  in een gumbeweging met aanraking breekt de gum niet meer af.
- Cache v22. Upload alle app-assets en behoud de bestaande vendor-map.

## Versie 20.5: snellere gum, lasso hersteld, taken en notities via WerkHub

- **Gum sneller.** De gum rekent alleen nog streken door die in de buurt van de gum
  liggen en tekent bij het gummen alleen het geraakte stukje opnieuw in plaats van
  het hele blad. Op een testbord met 1800 streken ging dat van ruim 9 naar ruim 2
  seconden voor 120 gumbewegingen; de rekenstap zelf van 17 seconden naar 0,1 seconde
  op 4000 streken. Het beeld is pixel voor pixel gelijk aan een volledig herteken.
- **Lasso hersteld en beter.** De lasso crashte bij de eerste aanraking (een variabele
  met dezelfde naam als de selectie). Nu: streken die voor minstens de helft in de lus
  liggen worden gekozen, een tik kiest één streek of tekstblok, getypte tekstblokken
  (ook AI-antwoorden) gaan mee, en je versleept de selectie door ergens in het
  oranje vak te slepen. Verplaatsen, knippen, kopieren en plakken zijn met Ongedaan
  terug te draaien. Verplaatsen kopieert geen hele bord meer, dus het blijft vlot.
- **Taak aanmaken in WerkHub.** Ronde knop Taak (✓) naast Vraag/Herken. Eerste regel
  wordt de taak, de rest de notitie; optioneel een deadline, of kies Subtaak voor
  tussendoor (geen datum). Met het vinkje worden alle regels aparte taken (maximaal 20).
  Onder een AI-antwoord of herkende handschrifttekst staat Maak taak in WerkHub van
  dit antwoord. De taak komt als PWN-taak, status Nog beginnen, in WerkHub. Gebruikt de
  bestaande WerkHub-login; er gaat niets naar AI. Subtaken vereisen
  TAKEN-SUBTAKEN-MIGRATIE.sql (staat in de solo-leveling repo).
- **Notities opslaan in WerkHub, ook voor de pc.** Onder Back-up staat WerkHub: notities
  delen. Bewaar dit in WerkHub of Bewaar alles zet schriften en borden (penstreken en
  tekstblokken) in WerkHub; Lijst uit WerkHub en Haal geselecteerde op zet ze op een
  ander apparaat terug. Op de pc open je dezelfde Werkplek-link, log je op Vandaag in bij
  WerkHub en schrijf je met de muis. Alleen na een klik; PDF-bestanden en meetlijsten
  blijven lokaal. Bestaat het document al lokaal dan vraagt de app eerst bevestiging
  voordat de WerkHub-versie het vervangt. Vereist eenmalig
  WERKPLEK-NOTITIES-MIGRATIE.sql in Supabase (nieuwe tabel werkplek_documents, alleen de
  eigenaar heeft toegang).
- Cache v23; werkhub.js is nieuw. Upload alle app-assets, behoud de vendor-map.

Getest met nagebootste WerkHub/Supabase-antwoorden in Chrome: gum, lasso, taken,
subtaken, opslaan en ophalen. Echte Supabase-tabel, live WerkHub-login en fysieke iPad
zijn nog niet geverifieerd.

## Versie 21

- Back-up openen: Werkmap > Back-up > "Open back-up (toevoegen)" voegt documenten uit een gedownload bestand toe zonder iets weg te halen. "Zet back-up terug" vervangt alles.
- Lasso: boven de selectie verschijnt een menu met Kopieer, Knip, Taak en Subtaak. Lang drukken met de pen geeft ook "Opslaan als taak/subtaak".
- Taak uit handschrift: AI (Gemini via werkplek-ai) leest de selectie of het hele blad en stelt taken voor, met deadline als die erin staat (regel: taak | JJJJ-MM-DD). Eerst eenmalig toestemming aanvinken; je controleert altijd voor het opslaan.
- Opslag: notities staan nu in IndexedDB (veel meer ruimte), met localStorage als reservekopie zolang die past.
- WerkHub: het open schrift/bord wordt automatisch elke 30 seconden bewaard als er iets veranderd is. Is het op een ander apparaat nieuwer bewaard, dan wordt niets overschreven en krijg je een melding. PDF's blijven lokaal.
- Agenda op Vandaag: lijst via de edge function werkhub-agenda (geen Google-iframe, geen cookieproblemen). Instellen: secret AGENDA_ICS_URLS in Supabase (zie WerkHub TAKEN-INSTELLEN.txt). De oude widget staat nog onder "Oude Google-widget".
- Google Drive: de login start nu direct vanuit je tik (geen geblokkeerde pop-up) en geeft duidelijke foutmeldingen. Nieuw: "Koppel via doorsturen" voor de beginscherm-app. Daarvoor moet in Google Cloud > Credentials bij de OAuth-client staan:
  - Authorized JavaScript origins: https://remyster.github.io
  - Authorized redirect URIs: https://remyster.github.io/ipad-werkplek/
  - Google Drive API aan, en je account bij Test users (OAuth consent screen).

## Versie 22

- Wat nu (Vandaag): je volgende WerkHub-taak (te laat eerst, dan mee bezig, dan deadline), je volgende afspraak en een focustimer (10/25/45 min, of "past tot afspraak"). Start zet de taak op bezig, Klaar zet hem op klaar. Zwevende timer onderin op elke tab, zacht geluid en melding als de tijd om is, teller "vandaag al X af".
- Zoeken: zoekbalk boven Werkmap zoekt in titels, getypte tekst en (na AI-lezen) in je handschrift.
- AI-titels: met het vinkje onder "Slim" leest AI op de achtergrond je schriften; "Nieuw schriftblad" krijgt vanzelf een titel uit de eerste regel.
- Vangnet: Weggooien vraagt niks meer en zet het document 30 dagen in de prullenbak (met "Zet terug" in de melding). Elke 10 minuten schrijven bewaart een versie (laatste 20 per blad), terug te zetten via Werkmap > Vangnet.
- Taakvakjes: teken een vierkantje (of lang drukken > "Taakvakje hier") en schrijf er een taak achter. Na een paar tellen staat hij in WerkHub (groen bolletje). Vink het vakje af: klaar in WerkHub. Uit te zetten onder "Slim".

## Versie 23

- Wat nu = drie bakken (Eisenhower), zonder timer: 🔥 Urgent (moet zsm), 📌 Belangrijk (inplannen, met knop 📅 Plan naar Google Agenda), 🧩 Wel doen (subtaken voor tussendoor). Wacht-op-iemand staat er klein onder. Vinkje = klaar in WerkHub en weg (met Ongedaan).
- Taak maken (ook via AI en taakvakjes) kiest Urgent, Belangrijk of Subtaak; AI zet dat per regel ("taak | datum | urgent").
- Agenda op Vandaag: alleen vandaag en morgen, compact.
- WerkHub en AI Hub staan altijd open, naast elkaar op Vandaag.

## Versie 24

- Alles automatisch in de cloud: schriften, borden, meetstatussen, getypte en ingesproken tekst, mappen en weggooien. Elk apparaat waar je één keer inlogt bij WerkHub (iPad, iPhone, pc, Android, Chrome) heeft binnen seconden hetzelfde. Status rechtsboven (☁️). Bij gelijktijdige wijzigingen wint dit apparaat; de andere versie staat in Vangnet. Vereist WERKPLEK-CLOUD-MIGRATIE.sql.
- PDF's: meerdere tegelijk toevoegen (knop PDF's erbij). Originelen gaan naar de privé-bucket werkplek-pdf en worden op een ander apparaat vanzelf opgehaald.
- Inspreken: 🎤 bij elk tekstveld (meetstatus, observaties, notities, taak, titel) en "Inspreek" op het blad. Gemini schrijft het uit (edge function werkplek-ai v12, taak dictation).
- Back-up opgeruimd: alleen Extra > Kopie naar Google Drive (één tik) en Download/Open kopie.
- WerkHub-knoppen "bewaar dit / lijst / ophalen" zijn weg: dat gaat nu vanzelf.
