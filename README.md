# Rainier Getaway

View it live: https://rainier-getaway.com/

A static website for Rainier Getaway, a mountain retreat near Mount Rainier National Park.

The site includes:

- Property gallery and amenities
- Direct booking terms and platform booking links
- A React availability calendar
- Availability parsed from `calendars/combined.ics`

## Requirements

- Node.js and npm
- Python 3 for the local HTTP server

## Install

From the project directory:

```powershell
npm install
```

There are no runtime npm dependencies. The browser loads React and `react-calendar` from CDN URLs.

## Run Tests

Run the availability parser tests:

```powershell
npm.cmd test
```

PowerShell may block the `npm.ps1` script because of its execution policy. Use `npm.cmd` as shown above. The test suite covers iCal date parsing, reserved date ranges, canceled events, folded lines, combined calendar loading, and invalid calendar responses.

## Test the Calendar Locally

The page must be served over HTTP. Do not open `index.html` directly with `file://`, because browsers may block the page from loading the local calendar file (NOTE: everything else in the page will work other than the calendar).

Start a local server from the project directory:

```powershell
python -m http.server 8000
```

Open the site at:

```text
http://localhost:8000/
```

The calendar loads availability from:

```text
calendars/combined.ics
```

If your Github Action is not setup yet, copy in any ICS file and rename it to the expect filename.

To stop the server, press `Ctrl+C` in the terminal running it.

## Calendar Updates

The GitHub Actions workflow `.github/workflows/update-calendars.yml` downloads the Airbnb and VRBO iCal feeds, removes duplicate events, and writes the merged result to `calendars/combined.ics`. It runs periodically and can also be started manually with the `workflow_dispatch` trigger.

The website itself does not request Airbnb or VRBO directly. It reads only the generated combined calendar file.

The GitHub Actions workflow `.github/workflows/update-reviews.yml` opens the Airbnb reviews dialog, collects the review responses, filters five-star reviews, and writes them to `reviews.json`. It runs every six hours and can also be started manually with the `workflow_dispatch` trigger.

## Project Structure

```text
index.html                         Main website
availability.js                    Calendar loading and iCal parsing
availability.test.js               Availability unit tests
calendars/combined.ics             Generated merged availability calendar
.github/workflows/update-calendars.yml
                                    Scheduled calendar update workflow
.github/workflows/update-reviews.yml
                                    Scheduled Airbnb review update workflow
scripts/fetch-airbnb-reviews.mjs    Airbnb review scraper
reviews.json                        Generated five-star review data
```
