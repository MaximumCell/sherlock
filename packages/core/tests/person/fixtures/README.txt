Recorded upstream responses for the name-search modules, trimmed to the fields the code reads.
All live recordings are of PUBLIC FIGURES, made on 2026-11-20 (wikidata_entities / orcid_record
first seen 2026-11-19 and re-fetched on 2026-11-20):

  openalex_authors.json        GET api.openalex.org/authors?search=Tim Berners-Lee&per-page=5
  orcid_search.json            GET pub.orcid.org/v3.0/expanded-search/?q=(family-name:"Berners Lee" AND given-names:tim*) OR ...
  orcid_record.json            GET pub.orcid.org/v3.0/0000-0003-1279-3709/record
  wikidata_search.json         GET wikidata.org/w/api.php?action=wbsearchentities&search=Tim Berners-Lee
  wikidata_entities.json       GET ...?action=wbgetentities&ids=Q80|Q120373140&props=labels|descriptions|aliases|claims|sitelinks
  wikidata_labels.json         GET ...?action=wbgetentities&ids=<occupation/employer/school QIDs of Q80>&props=labels
  github_search_users.json     GET api.github.com/search/users?q=fullname:"Linus Torvalds"&per_page=5
  github_user.json             GET api.github.com/users/torvalds
  serpapi_google.json          GET serpapi.com/search.json?engine=google&q=test   (no key: the cached demo search;
                               shows the organic_results shape only)

SYNTHETIC (no live 200 could be recorded without an API key; built from the official schema,
fictional person and companies, includes address / date-of-birth fields to prove they are dropped):

  companies_house_officer_search.json, companies_house_appointments.json
