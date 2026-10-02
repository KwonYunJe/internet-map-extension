# Public Suffix List

public_suffix_list.dat is an unmodified snapshot from
https://publicsuffix.org/list/public_suffix_list.dat.
Its version/commit and MPL-2.0 license notice are retained in its header.
Source and license: https://github.com/publicsuffix/list

Both ICANN and PRIVATE sections are used. The bundled snapshot loads locally;
no browsing history or hostname is sent to a lookup service.
Refresh from the upstream URL during maintenance and run the grouping/UI tests.

Grouping retains the registrable domain plus one service label, except www.
Raw sessions and exports remain unchanged. Custom service roots can be declared
in SITE_GROUP_OVERRIDES in visualization/site-grouping.js.
