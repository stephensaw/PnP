// variable used for cross site CSOM calls
var context;
var language = {
    TaxonomyPicker_Dialog_Header: "Select: ",
    TaxonomyPicker_Dialog_Button_Text: "Select"
}

function chromeLoaded() {
    $('body').show();
}

//Wait for the page to load
$(document).ready(function () {

    'use strict';

    //Get the URI decoded SharePoint site url from the SPHostUrl parameter.
    var spHostUrl = decodeURIComponent(getQueryStringParameter('SPHostUrl'));
    var appWebUrl = decodeURIComponent(getQueryStringParameter('SPAppWebUrl'));
    var spLanguage = decodeURIComponent(getQueryStringParameter('SPLanguage'));

    //Build absolute path to the layouts root with the spHostUrl
    var layoutsRoot = spHostUrl + '/_layouts/15/';

    //function callback to render chrome after SP.UI.Controls.js loads
    function renderSPChrome() {
        //Set the chrome options for launching Help, Account, and Contact pages
        var options = {
            'appTitle': document.title,
            'onCssLoaded': 'chromeLoaded()'
        };

        //Load the Chrome Control in the divSPChrome element of the page
        var chromeNavigation = new SP.UI.Controls.Navigation('divSPChrome', options);
        chromeNavigation.setVisible(true);
    }

    //load all appropriate scripts for the page to function
    $.getScript(layoutsRoot + 'SP.Runtime.js',
        function () {
            $.getScript(layoutsRoot + 'SP.js',
                function () {
                    //Load the SP.UI.Controls.js file to render the App Chrome
                    $.getScript(layoutsRoot + 'SP.UI.Controls.js', renderSPChrome);

                    //load scripts for cross site calls (needed to use the people picker control in an IFrame)
                    $.getScript(layoutsRoot + 'SP.RequestExecutor.js', function () {
                        context = new SP.ClientContext(appWebUrl);
                        var factory = new SP.ProxyWebRequestExecutorFactory(appWebUrl);
                        context.set_webRequestExecutorFactory(factory);
                    });

                    //load scripts for calling taxonomy APIs
                    $.getScript(layoutsRoot + 'init.js',
                        function () {
                            $.getScript(layoutsRoot + 'sp.taxonomy.js',
                                function () {
                                    //termset used for dependant selection

                                    var termId = "4edc1fc7-cbb3-4589-8941-048e7e7fd5df";

                                    //bind taxpickers that depend on eachothers choices
                                    $('#taxPickerContinent').taxpicker({
                                        mode: 'designer',
                                        isMulti: false,
                                        allowFillIn: false,
                                        languageResource: language,
                                        useKeywords: false,
                                        termStoreId: "d762d1db-38dd-4492-bcc4-59bd0febab28",
                                        groupId: "d467bf92-45f2-405c-be9a-51d51fd7190a",
                                        termSetId: "4edc1fc7-cbb3-4589-8941-048e7e7fd5df",
                                        anchorPath: "cddfb72e-e8cc-4d5d-a2fb-ce9832b7a0f7/2feb6ece-bf24-4247-bd43-e971b7dbf402",
                                        anchorId: "2feb6ece-bf24-4247-bd43-e971b7dbf402",
                                        termSetImageUrl: "/Styles/Images"
                                    }, context);
                                    //
                                });
                        });
                });
        });

    $('#doStuff').click(function (e) {
        var selectedTerms = JSON.parse($('#taxPickerContinent').val())[0] || "";
        var selectedValue = [{
            "name": selectedTerms.name,
            "termStoreId": selectedTerms.termStoreId,
            "groupId": selectedTerms.groupId,
            "termSetId": selectedTerms.termSetId,
            "anchorId": selectedTerms.anchorId,
            "anchorPath": selectedTerms.anchorPath
        }];

        $('#taxPickerFiller').taxpicker(
            {
                mode: 'runtime',
                isMulti: false,
                allowFillIn: false,
                useKeywords: false,
                languageResource: language,
                termStoreId: selectedTerms.termStoreId,
                groupId: selectedTerms.groupId,
                termSetId: selectedTerms.termSetId,
                anchorId: selectedTerms.anchorId,
                anchorPath: selectedTerms.anchorPath
            }, context)
    });
});


//function to get a parameter value by a specific key
function getQueryStringParameter(urlParameterKey) {
    var params = document.URL.split('?')[1].split('&');
    var strParams = '';
    for (var i = 0; i < params.length; i = i + 1) {
        var singleParam = params[i].split('=');
        if (singleParam[0] == urlParameterKey)
            return singleParam[1];
    }
}