(function () {
    'use strict';

    var CAMControl = {};
    var spContext; //global sharepoint context used throughout the taxonomy picker control (set in the taxpicker constructor)
    var taxIndex = 0; //keeps index of the taxonomy pickers in use

    CAMControl.TAXONOMYENUM = {
        TermStore: "TermStore",
        Group: "Group",
        TermSet: "TermSet",
        Term: "Term"
    };

    function Term () {
        this.id = "";
        this.name = "";
        this.termStoreId = "";
        this.groupId = "";
        this.termSetId = "";
        this.anchorId = "";
        this.anchorPath = "";
    }

    function CacheManager () {
        var cachedData = {};

        var setCache = function (cacheKey, data) {
            cachedData[cacheKey] = data;
        }

        var getCache = function (cacheKey) {
            return cachedData[cacheKey];
        }

        var removeCache = function (cacheKey) {
            cachedData[cacheKey] = null;
        }

        var updateCache = function (cacheKey, data) {
            if (!getCache(cacheKey)) {
                setCache(cacheKey, data);
            }
        }

        return {
            getCache: getCache,
            setCache: setCache,
            updateCache: updateCache,
            removeCache: removeCache
        }
    }

    function Taxonomy (options) {
        this.TermStoreId = options.termStoreId;
        this.GroupId = options.groupId;
        this.TermSetId = options.termSetId;
        this.AnchorId = options.anchorId;
        this.AnchorPath = options.anchorPath;
        this.Loaded = false; //boolean indicating if the terms have been returned and loaded from CSOM
        this.KeyDownCallback = options.keyDownCallback; // optional external callback when term set text updated
        this.TermSetLoaded = false; //boolean indicating if the termset details are loaded
        this.NewTerm = null; //the new term being added
        this.CacheManager = null;
    }

    jQuery.extend(Taxonomy.prototype, {
        initialize: function () {
            this.CacheManager = new CacheManager();
        },

        executeQuery: function (item) {
            var $deferred = jQuery.Deferred();

            spContext.executeQueryAsync(Function.createDelegate(this, function () {
                $deferred.resolve(item);
            }), Function.createDelegate(this, function (sender, args) {
                $deferred.reject(sender, args);
            }));

            return $deferred.promise();
        },

        loadTermStores: function () {
            var taxSession = SP.Taxonomy.TaxonomySession.getTaxonomySession(spContext);
            var termStores = taxSession.getDefaultSiteCollectionTermStore();

            spContext.load(termStores);
            return this.executeQuery(termStores);
        },

        loadGroups: function (termStore) {
            var groups = termStore.get_groups();

            spContext.load(groups, "Include(Id, Name)");
            return this.executeQuery(groups);
        },

        loadTermSets: function (group) {
            var termSets = group.get_termSets();

            spContext.load(termSets, "Include(Id, Name)");
            return this.executeQuery(termSets);
        },

        loadTerms: function (termSet) {
            var terms = termSet.get_terms();

            spContext.load(terms, "Include(Id, Name, TermsCount)");
            return this.executeQuery(terms);
        }
    });

    function TaxonomyPicker (control, options, context) {
        this.Taxonomy = new Taxonomy(options);

        this._context = context; //Context passed in from control
        this.LCID = (options.lcid) ? options.lcid : 1033; //the locale id for term creation (default is 1033)
        this.LanguageResource = options.languageResource;
        this.MarkerMarkup = '<span id="caretmarker"></span>'; //the marketup const
        this._taxPickerIndex = options.taxPickerIndex; //the index within the jQuery.taxpicker array
        this._isMulti = options.isMulti; //specifies if the user can select multiple terms
        this._isReadOnly = options.isReadOnly; //specifies whether the control is used for display purposes 
        this._initialValue = control.val(); //the initial value of the control
        this._control = control; //the wrapper container all the taxonomy pickers controls are contained in
        
        this._dlgButton = null; //the button used to launch the taxonomy picker dialog
        this._editor = null; //the editor control for the taxonomy picker
        this._hiddenValidated = control; //the hidden control that contains all validated term selections
        this._waitingDlg = null; //the waiting dialog
        this._selectedTerms = []; //Array of selected terms
        this._tempSelectedTerms = []; //Snapshot of selected terms for use in the picker dialog (kept to support cancel in the dialog)
        this._expandingNodes = false;
        this._controlMode = options.mode !== undefined ? options.mode.toLowerCase() : "designer";

        this._dialog = null; //the dialog control
        this._dlgCurrTerm = null; //the current term highlighted in the taxonomy picker dialog
        this._dlgCurrTermNode = null; //the current tree node selected
        this._dlgCloseButton = null; //the Close button in the taxonomy picker dialog
        this._dlgOkButton = null; //the Ok button in the taxonomy picker dialog
        this._dlgCancelButton = null; //the Cancel button in the taxonomy picker dialog
        this._dlgSelectButton = null; //the Select >> button in the taxonomy picker dialog
        this._dlgEditor = null; //the editor control in the taxonomy picker dialog
        this._dlgAddNewTermButton = null; //the "Add New Item" link display in the dialog for Open TermSets
        this._dlgNewNode; //container for a new node added to an Open Termset in the taxonomy picker dialog
        this._dlgNewNodeEditor; //the editor field for add new node in the taxonomy picker dialog

        this.initialize();
    }

    jQuery.extend(TaxonomyPicker.prototype, {
        initialize: function () {
            this.Taxonomy.initialize();

            this._control = jQuery('<div class="cam-taxpicker"></div>');

            var parent = this._hiddenValidated.parent();

            this._hiddenValidated = this._hiddenValidated.detach();
            parent.append(this._control);
            
            if (!this._enterFillIn) {
                this._dlgButton = jQuery('<div class="cam-taxpicker-button"></div>');
            }

            if (!this._isReadOnly) {
                this._editor = jQuery('<div class="cam-taxpicker-editor" contenteditable="true"></div>');
                this._control.empty().append(this._editor).append(this._dlgButton).append(this._hiddenValidated);
                this._control.after(this._suggestionContainer);
            } else {
                this._editor = jQuery('<div class="cam-taxpicker-editor-readonly" contenteditable="false"></div>');
                this._control.empty().append(this._editor).append(this._hiddenValidated);
            }

            //initialize value if it exists
            if (this._initialValue != undefined && this._initialValue.length > 0) {
                if (this._controlMode === "designer") {
                    var terms = JSON.parse(this._initialValue);

                    for (var i = 0; i < terms.length; i++) {
                        var t = JSON.parse(JSON.stringify(terms[i]));
                    
                        this._selectedTerms.push(t);
                    }
                } else {
                    var terms = this._initialValue.split(";");

                    for (var i = 0; i < terms.length; i++) {
                        var term = terms[i].split("|");
                        var selectedTerm = new Term();

                        selectedTerm.id = term[1];
                        selectedTerm.name = term[0];

                        this._selectedTerms.push(selectedTerm);
                    }
                }

                this._editor.html(this.selectedTermsToHtml());
            }

            this._dlgButton.click(Function.createDelegate(this, this.showPickerDialog)); //dialog button is clicked
            this._editor.keydown(Function.createDelegate(this, this.keydown)); //key is pressed in the editor control
            jQuery(document).mousedown(Function.createDelegate(this, this.checkExternalClick)); //mousedown somewhere in the document
        },

        reset: function () {
            this._selectedTerms = [];
            this._editor.html('');
        },

        //handle keydown event in editor control
        keydown: function (event, args) {
            // if the control is readonly then ignore all keystrokes
            if (this._isReadOnly) { return false; }
            //get the keynum
            var keynum = event.which;

            //get all parameters to deal with the key event
            var caret = this.getCaret(this._editor[0]); //the cursor position
            var rawText = this._editor.text(); //the raw text in the editor (html stripped out)        
            var selection = '';
            if (window.getSelection) //get selection (highlighted text)
                selection = window.getSelection().toString(); //modern browser
            else
                selection = document.selection.createRange().text; //IE<9

            //handle specific keys
            if (keynum == 46) { //delete key pressed
                //delete anything that was selected
                if (selection.length > 0) {
                    var newText = rawText.substring(0, caret - selection.length) + this.MarkerMarkup + rawText.substring(caret, rawText.length);
                    var textValidation = this.validateText(newText);
                    this._editor.html(textValidation.html);

                    //set the cursor position at the marker
                    this.setCaret();

                    //show suggestions
                    this.showSuggestions(textValidation, caret);
                }

                //cancel the keypress
                return false;
            }
            else if (keynum == 8) { //backspace key pressed
                //delete anything that was selected OR the last character if nothing selected
                var newText = '';
                if (selection.length > 0) {
                    newText = rawText.substring(0, caret - selection.length) + this.MarkerMarkup + rawText.substring(caret, rawText.length);
                    var textValidation = this.validateText(newText);
                    this._editor.html(textValidation.html);
                    
                    if (newText === '<span id="caretmarker"></span>') {
                        //empty the selected term from hidden field
                        this._hiddenValidated.val("");
                        //added to trigger the change event 
                        this._hiddenValidated.trigger('change');
                    }

                    //set the cursor position at the marker
                    this.setCaret();

                    //show suggestions
                    this.showSuggestions(textValidation, caret - selection.length - 1);
                }
                else {
                    var firstPart = rawText.substring(0, caret - 1);
                    if (firstPart.charAt(firstPart.length - 1) == ';')
                        firstPart = firstPart.substring(0, firstPart.length - 1);
                    newText = firstPart + this.MarkerMarkup + rawText.substring(caret, rawText.length);
                    var textValidation = this.validateText(newText);
                    this._editor.html(textValidation.html);
                    
                    if (newText === '<span id="caretmarker"></span>') {
                        //empty the selected term from hidden field
                        this._hiddenValidated.val("");
                        //added to trigger the change event 
                        this._hiddenValidated.trigger('change');
                    }

                    //call keyDownCallback event if not null
                    if (this.Taxonomy.KeyDownCallback != null)
                        this.Taxonomy.KeyDownCallback();

                    //set the cursor position at the marker
                    this.setCaret();

                    //show suggestions
                    this.showSuggestions(textValidation, caret - 2);
                }

                //cancel the keypress
                return false;
            }
            else if (keynum >= 48 && keynum <= 90 || keynum == 32) { // An ascii character or a space has been pressed
                // keynum is not taking in account shift key and always results in the uppercase value
                if (event.shiftKey == false && keynum >= 65 && keynum <= 90) {
                    keynum += 32;
                }

                //get new text, taking in account selections
                var newText = ''
                var char = String.fromCharCode(keynum);
                if (keynum == 32) //convert space to &nbsp;
                    char = '&nbsp;';

                //calculate new text and then convert to html
                if (caret < rawText.length)
                    newText = rawText.substring(0, caret - selection.length) + String.fromCharCode(keynum) + this.MarkerMarkup + rawText.substring(caret, rawText.length);
                else
                    newText = rawText.substring(0, caret - selection.length) + rawText.substring(caret, rawText.length) + String.fromCharCode(keynum) + this.MarkerMarkup;

                //get text validation and set html in editor
                var textValidation = this.validateText(newText);
                this._editor.html(textValidation.html);

                //call keyDownCallback event if not null
                if (this.Taxonomy.KeyDownCallback != null)
                    this.Taxonomy.KeyDownCallback();

                //set the cursor position at the marker
                this.setCaret();

                //show suggestions
                this.showSuggestions(textValidation, caret);
                return false;
            }
            else if (keynum == 9 || keynum == 13) { //Tab key pressed and also validate on enter
                // support for selecting a suggestion
                var sel = this._suggestionContainer.children('.cam-taxpicker-suggestion-item.selected');
                if (sel.length > 0) {
                    this._editor.blur();
                    sel.click();
                    this._editor[0].focus();
                    this.placeCaretAtEnd(this._editor[0]);
                    return false;
                }

                //validate raw text OR mark invalid
                var textValidation = this.validateText(rawText);
                var html = this.markInvalidTerms(textValidation);
                this._editor.html(html);

                //close the suggestion panel
                this._suggestionContainer.hide();

                this._editor[0].focus();
                this.placeCaretAtEnd(this._editor[0]);

                if (keynum == 13) { // also validate on enter, we need to cancel the enter and blur
                    //this._editor.blur();
                    return false;
                }
            }
            else if (keynum == 38 || keynum == 40) { // selecting suggestion with Up or Down key
                if (this._suggestionContainer.css('display') != 'none') {
                    var sel = this._suggestionContainer.children('.cam-taxpicker-suggestion-item.selected');
                    if (sel.length == 0) {
                        sel = this._suggestionContainer.children('.cam-taxpicker-suggestion-item').first();
                        sel.addClass('selected');
                    }
                    else {
                        sel.removeClass('selected');
                        if (keynum == 38) {
                            sel = sel.prev();
                            if (sel.attr('data-item') == null)
                                sel = this._suggestionContainer.children('.cam-taxpicker-suggestion-item').last();
                        }
                        else {
                            sel = sel.next();
                            if (sel.length == 0)
                                sel = this._suggestionContainer.children('.cam-taxpicker-suggestion-item').first();
                        }
                        sel.addClass('selected');
                    }
                }
            }           
        },

        //get the cursor position in a content editable div
        getCaret: function (target) {
            var isContentEditable = target.contentEditable === 'true';

            //HTML5
            if (window.getSelection) {
                //contenteditable
                if (isContentEditable) {
                    target.focus();
                    var range1 = window.getSelection().getRangeAt(0),
                        range2 = range1.cloneRange();
                    range2.selectNodeContents(target);
                    range2.setEnd(range1.endContainer, range1.endOffset);
                    return range2.toString().length;
                }
                //textarea
                return target.selectionStart;
            }
            //IE<9
            if (document.selection) {
                target.focus();
                //contenteditable
                if (isContentEditable) {
                    var range1 = document.selection.createRange(),
                        range2 = document.body.createTextRange();
                    range2.moveToElementText(target);
                    range2.setEndPoint('EndToEnd', range1);
                    return range2.text.length;
                }
                //textarea
                var pos = 0,
                    range = target.createTextRange(),
                    range2 = document.selection.createRange().duplicate(),
                    bookmark = range2.getBookmark();
                range.moveToBookmark(bookmark);
                while (range.moveStart('character', -1) !== 0) pos++;
                return pos;
            }
            //not supported
            return 0;
        },

        //sets the cursor caret (position in the editor control)
        setCaret: function () {
            //find the marker
            var marker = null;
            // getting the marker in more reliably
            var jQmarker = this._editor.find('span#caretmarker');
            if (jQmarker.length > 0)
                marker = jQmarker.get(0);

            if (marker != null) {
                //HTML5
                if (window.getSelection) {
                    //set cursor at the marker
                    var range = document.createRange();
                    range['setStartAfter'](marker);
                    var selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
                //IE<9
                if (document.selection) {
                    //TODO: this isn't currently working without a selection (BUG)
                    /*
                    range = document.selection.createRange();
                    var range1 = range.duplicate();
                    range1.moveToElementText(marker);
                    range.setEndPoint('StartToEnd', range1);
                    range.setEndPoint('EndToStart', range1);
                    */
                }

                //remove the marker
                marker.parentNode.removeChild(marker);
            }
        },

        //place the cursor at the end of the contentEditable div
        placeCaretAtEnd: function (el) {
            el.focus();
            if (typeof window.getSelection != "undefined"
                    && typeof document.createRange != "undefined") {
                var range = document.createRange();
                range.selectNodeContents(el);
                range.collapse(false);
                var sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            } else if (typeof document.body.createTextRange != "undefined") {
                var textRange = document.body.createTextRange();
                textRange.moveToElementText(el);
                textRange.collapse(false);
                textRange.select();
            }
        },

        //validates the text input into ranges and html output
        validateText: function (txt) {
            var textValidation = { html: '', ranges: [] };
            var terms = txt.split(';');
            var newTerms = [];
            var ptr = 0;
            var rPtr = 0;

            //loop through parts and look for existing validations
            for (var i = 0; i < terms.length; i++) {
                var t = terms[i].replace(/^\s+/, ""); //trim left
                var t_compare = t.replace(this.MarkerMarkup, '');
                var r = { id: terms[i].id, text: t, bottom: rPtr, top: (rPtr + t.length - 1), valid: false };
                rPtr = r.top;
                for (var j = ptr; j < this._selectedTerms.length; j++) {
                    if (this._selectedTerms[j].name.toLowerCase() == t_compare.toLowerCase()) {
                        newTerms.push(this._selectedTerms[j]);
                        r.valid = true;
                        ptr = j + 1;
                        break;
                    }
                }

                //add to the range selection
                textValidation.ranges.push(r);

                //build the html for this
                if (r.valid)
                    textValidation.html += '<span class="cam-taxpicker-term-selected">' + t + '</span>';
                else
                    textValidation.html += t;

                //add separator
                if (i < terms.length - 1) {
                    textValidation.html += '<span>;&nbsp;</span>';
                    rPtr += 3;
                }
            }
            //reset this._selectedTerms
            this._selectedTerms = newTerms;
            this._hiddenValidated.val(this.getSelectedTermsValue(this._selectedTerms));

            return textValidation;
        },

        //marks text input with valid and invalid markup
        markInvalidTerms: function (textValidation) {
            return;

            var html = '';
            for (var i = 0; i < textValidation.ranges.length; i++) {
                if (textValidation.ranges[i].valid)
                    html += '<span class="cam-taxpicker-term-selected">' + textValidation.ranges[i].text + '</span>';
                else {
                    //check for a single match we can validate against
                    var matches = this.Taxonomy.getTermsByLabel(textValidation.ranges[i].text);
                    if (matches.length == 1 && (this._selectedTerms.length == 0 || this._isMulti)) {
                        this.pushSelectedTerm(matches[0]);
                        html += '<span class="cam-taxpicker-term-selected">' + textValidation.ranges[i].text + '</span>';
                    }
                    else {
                        if (this._enterFillIn){
                            var termNew = new Term();
                            var id = newGuid();

                            termNew.id = id;
                            termNew.name =  textValidation.ranges[i].text;
                            
                            this._selectedTerms.push(termNew);
                            this._hiddenValidated.val(JSON.stringify(this._selectedTerms));
                            
                            this.pushSelectedTerm(termNew);

                            html += '<span class="cam-taxpicker-term-selected">' + textValidation.ranges[i].text + '</span>';
                        }
                        else{
                            html += '<span class="cam-taxpicker-term-invalid">' + textValidation.ranges[i].text + '</span>';                  
                        }
                    }

                    //check for ambiguous matches
                    if (matches.length > 1) {
                        //TODO: popup anbiguous terms dialog (Enhancement)
                    }
                }

                if (i < textValidation.ranges.length - 1)
                    html += '<span>;&nbsp;</span>';
            }
            return html;
        },

        //term node is clicked in the treeview
        termNodeClicked: function (event) {
            this._dlgCurrTermNode = jQuery(event.target.parentNode);

            if (!this._dlgCurrTermNode.data("selectable")) {
                this._dlgCurrTerm = null;
                return;
            }

            //change the style of the node to selected
            jQuery('.cam-taxpicker-treenode-title').removeClass('selected');
            this._dlgCurrTermNode.addClass('selected');

            //get the term clicked and set currNode
            var id = this._dlgCurrTermNode.data("id");
            var cachedTerm = this.Taxonomy.CacheManager.getCache(id).item;
            var term = new Term();

            term.id = cachedTerm.get_id().toString();
            term.name = cachedTerm.get_name();
            
            this._dlgCurrTerm = term;
        },

        //term node is double clicked in the treeview
        termNodeDoubleClicked: function (event) {
            this._dlgCurrTermNode = jQuery(event.target.parentNode);

            var term = new Term();

            term.id = this._dlgCurrTermNode.data("id");
            term.name = this._dlgCurrTermNode.data("name");

            this.addHighlightedTermToSelection(term);
        },

        addHighlightedTermToSelection: function (term) {
            if (this._dlgCurrTermNode.data("selectable")) {
                var parentNodes = this._dlgCurrTermNode.closest("li").parents("li");
                var paths = [];

                // building paths from the selected node parents backward
                for (var i = parentNodes.length - 1; i >= 0 ; i--) {
                    var $node = jQuery(parentNodes[i]).find(".cam-taxpicker-treenode-title");

                    paths.push($node.data("id"));
                }

                paths.push(this._dlgCurrTermNode.data("id"));

                var term = new Term();

                term.id = this._dlgCurrTermNode.data("id");
                term.name = this._dlgCurrTermNode.data("name");
                
                if (this._dlgCurrTermNode.data("type") === CAMControl.TAXONOMYENUM.Term) {
                    term.anchorId = this.id;
                }

                if (paths.length >= 1) {
                    term.termStoreId = paths[0];
                }

                if (paths.length >= 2) {
                    term.groupId = paths[1];
                }

                if (paths.length >= 3) {
                    term.termSetId = paths[2];
                }

                if (paths.length >= 4) {
                    paths.splice(0, 3);
                    term.anchorPath = paths.join("/");
                }

                //add the term to selected terms array
                this.pushSelectedTerm(term);

                //refresh the html in the editor control
                this._dlgEditor.html(this.selectedTermsToHtml());
            }
        },

        //dialog select button is clicked...use this to add any selected node as a selected term
        dialogSelectButtonClicked: function (event) {
            if (this._dlgCurrTerm != null) {
                this.addHighlightedTermToSelection(this._dlgCurrTerm);
            }
        },

        //dialog OK button clicked
        dialogOkClicked: function (event) {
            //update the control value
            this._editor.html(this.selectedTermsToHtml());

            //close the dialog
            this.closePickerDialog(event);

            if (this._changeCallback != null)
                this._changeCallback();
        },

        //dialog Cancel button clicked
        dialogCancelClicked: function (event) {
            //reset the selected terms
            this._selectedTerms = this._tempSelectedTerms;

            //close the dialog
            this.closePickerDialog(event);
        },

        //dialog new term button is clicked
        dialogNewTermClicked: function (event) {
            if (jQuery('.cam-taxpicker-treenode-newnode').length > 0) // don't allow adding multiple nodes at once
                return;

            this._dlgNewNodeEditor = jQuery('<div class="cam-taxpicker-treenode-newnode" style="min-width: 100px;" contenteditable="true"></div>');
            this._dlgNewNode = jQuery('<li class="cam-taxpicker-treenode-li newNode"></li>').append(jQuery('<div class="cam-taxpicker-treenode"></div>').append('<div class="cam-taxpicker-expander"></div><img src="' + this.Taxonomy.TermSetImageUrl + '/EMMTerm.png" alt=""/>').append(this._dlgNewNodeEditor));

            // only one level allowed for keywords, so always add to the root
            if (this.Taxonomy.UseKeywords || this._dlgCurrTerm == null) {
                jQuery('.cam-taxpicker-treenode-title').removeClass('selected');
                var root = jQuery('.cam-taxpicker-treenode-title.root').first();
                root.addClass('selected');
                this._dlgCurrTermNode = root;
                this._dlgCurrTerm = null;
            }

            //get the container for the new node
            var ul = this._dlgCurrTermNode.parent().next();
            if (ul.length == 0) { // adding a term to a newly added term
                ul = jQuery('<ul class="cam-taxpicker-treenode-ul"></ul>').appendTo(this._dlgCurrTermNode.parent().parent());
            }
            ul.prepend(this._dlgNewNode);

            //toggle the expand on the parent node
            ul.show();
            this._dlgCurrTermNode.prev().prev().removeClass('collapsed');
            this._dlgCurrTermNode.prev().prev().addClass('expanded');

            //set focus on the newNode editor and wire events
            this._dlgNewNodeEditor.focus();
            this._dlgNewNodeEditor.keydown(Function.createDelegate(this, this.dialogNewTermKeydown));
        },

        //fires for each keydown in the new term editor
        dialogNewTermKeydown: function (event) {
            //check for Tab, Esc, or Enter keys
            var keynum = event.keyCode;

            if (keynum == 27) { //Esc pressed
                this.termNodeAddCancel(event);
            }
            else if (keynum == 13 || keynum == 9) { //Enter or Tab pressed
                //add the new term and cancel the keypress
                var txt = this._dlgNewNodeEditor.text();

                //ensure hashtags start with #
                if (this._useHashtags && txt.indexOf('#') != 0)
                    txt = '#' + txt;

                if (this._dlgCurrTerm != null)
                    this.Taxonomy.addTerm(txt, this, this._dlgCurrTerm.id);
                else
                    this.Taxonomy.addTerm(txt, this);

                //cancel the keypress for Enter
                if (keynum == 13)
                    return false;
            }
        },

        //used to check if focus is lost from the control (invalidate and hide suggestions)
        checkExternalClick: function (event) {
            //check if the target is outside the picker
            if (!jQuery.contains(this._control[0], event.target) && this._dialog != null && !jQuery.contains(this._dialog[0], event.target)) {
                var rawText = this._editor.text(); //the raw text in the editor (html stripped out)
                var textValidation = this.validateText(rawText); //get the text validation
                //var html = this.markInvalidTerms(textValidation); //mark invalid terms
                //this._editor.html(html); //set the editor
            }
        },

        //show the dialog picker
        showPickerDialog: function (event) {
            //capture what terms are current selected (so we can support cancel)
            this._tempSelectedTerms = this._selectedTerms.slice(0);

            if (this._dialog == null) {
                this._dialog = jQuery('<div class="cam-taxpicker-dialog"></div>');
                var dlg = jQuery('<div class="cam-taxpicker-dialog-content"></div>');

                //build dialog header with button
                var dlgHeader = jQuery('<div class="cam-taxpicker-dialog-content-header"><h1 class="cam-taxpicker-dialog-content-header-title">' + this.LanguageResource.TaxonomyPicker_Dialog_Header + this.Taxonomy.Name + '</h1></div>');
                this._dlgCloseButton = jQuery('<div class="cam-taxpicker-dialog-content-close"></div>');
                dlgHeader.append(this._dlgCloseButton);
                dlg.append(dlgHeader);

                //build dialog body
                var dlgSubheader = jQuery('<div class="cam-taxpicker-dialog-content-subheader"><div class="cam-taxpicker-dialog-content-subheader-img"></div></div>');
                this._dlgAddNewTermButton = jQuery('<a style="cursor: pointer;">' + this.LanguageResource.TaxonomyPicker_Dialog_Add_Link + '</a>');
                if (this.Taxonomy.IsOpenForTermCreation) {
                    dlgSubheader.append(jQuery('<div class="cam-taxpicker-dialog-content-subheader-title">' + this.LanguageResource.TaxonomyPicker_Dialog_Add_Title + '&nbsp;</div>'));
                    dlgSubheader.append(jQuery('<div class="cam-taxpicker-dialog-content-subheader-addnew"></div>').append(this._dlgAddNewTermButton));
                }
                var dlgBody = jQuery('<div class="cam-taxpicker-dialog-content-body"></div>');
                dlgBody.append(dlgSubheader);
                var dlgBodyContainer = jQuery('<div class="cam-taxpicker-dialog-tree-container" style="display: none"></div>');


                //build the termset hierarchy
                var $treeviewContainer = jQuery('<ul id="rootNode" class="cam-taxpicker-treenode-ul" style="height: 100%; margin-left: 0"></ul>');
                dlgBodyContainer.append($treeviewContainer);

                //build the dialog editor area
                //TODO: convert the dlgEditor with contenteditable="true" just like the main editor (Enhancement)
                this._dlgEditor = jQuery('<div class="cam-taxpicker-dialog-selection-editor" RestrictPasteToText="true" AllowMultiLines="false"></div>');
                this._dlgSelectButton = jQuery('<button>' + this.LanguageResource.TaxonomyPicker_Dialog_Button_Text + ' >></button>');

                var waitingDlg = jQuery('<div class="cam-taxpicker-dialog-waiting-container"> \
                                            <div class="cam-taxpicker-dialog-waiting-container-inner"> \
                                                <div aria-hidden="true">•</div> \
                                                <div aria-hidden="true">•</div> \
                                                <div aria-hidden="true">•</div> \
                                                <div aria-hidden="true">•</div> \
                                                <div aria-hidden="true">•</div> \
                                            </div> \
                                        </div>');
                dlgBody.append(waitingDlg);

                dlgBody.append(dlgBodyContainer).append(jQuery('<div class="cam-taxpicker-dialog-selection-container"></div>').append(this._dlgSelectButton).append(this._dlgEditor));
                dlg.append(dlgBody);
                this._dialog.empty().append(jQuery('<div class="cam-taxpicker-dialog-overlay"></div>')).append(dlg);

                //add button area
                var dlgButtonArea = jQuery('<div class="cam-taxpicker-dialog-button-container"></div>')
                this._dlgOkButton = jQuery('<button style="float: right;">Ok</button>');
                this._dlgCancelButton = jQuery('<button style="float: right;">Cancel</button>');
                dlgBody.append(dlgButtonArea.append(this._dlgCancelButton).append(this._dlgOkButton));

            }

            this._dlgEditor.html(this.selectedTermsToHtml());

            jQuery('body').append(this._dialog);

            if (!this.Taxonomy.Loaded) {
                if (this.Taxonomy.TermStoreId || this.Taxonomy.GroupId || this.Taxonomy.TermSetId || this.Taxonomy.AnchorId) {
                    this._expandingNodes = true;
                }

                if (this._controlMode === "designer") {
                    this.loadTermStore();
                } else {
                    this.loadForRuntime();
                }
            } else {
                this._dialog.show();
                this.enableClickEventOnNode(jQuery('#rootNode'));
            }
                
            this._dlgSelectButton.click(Function.createDelegate(this, this.dialogSelectButtonClicked));
            this._dlgCloseButton.click(Function.createDelegate(this, this.dialogCancelClicked));
            this._dlgOkButton.click(Function.createDelegate(this, this.dialogOkClicked));
            this._dlgCancelButton.click(Function.createDelegate(this, this.dialogCancelClicked));
            this._dlgAddNewTermButton.click(Function.createDelegate(this, this.dialogNewTermClicked));
        },

        loadForRuntime: function () {
            var taxSession = SP.Taxonomy.TaxonomySession.getTaxonomySession(spContext);
            var termStore = taxSession.getDefaultSiteCollectionTermStore();
            
            if (this.Taxonomy.AnchorPath.length === 0) {
                var termSet = termStore.getTermSet(this.Taxonomy.TermSetId);

                this.loadTermSetAsRoot(termSet, jQuery("#rootNode"));
            } else {
                var paths = this.Taxonomy.AnchorPath.split("/");
                var term = termStore.getTerm(paths[0]);

                this.loadTermAsRoot(term, jQuery("#rootNode"));
            }
        },

        loadTermStore: function () {
            var that = this;
            var $treeviewContainer = jQuery('#rootNode');

            this.Taxonomy.loadTermStores(this.Taxonomy.TermStoreId).then(function (termStore) {
                if (!that._expandingNodes) {
                    that.doneExpandingNodes();
                }

                var cacheObject = { item: termStore, firstLoad: true };

                that.Taxonomy.CacheManager.updateCache(termStore.get_id().toString(), cacheObject);

                buildTreeView($treeviewContainer, CAMControl.TAXONOMYENUM.TermStore, termStore.get_id().toString(), termStore.get_name(), true, false);

                that.enableClickEventOnNode($treeviewContainer);

                if (that.Taxonomy.GroupId) {
                    that.Taxonomy.CacheManager.getCache(that.Taxonomy.TermStoreId).firstLoad = false;
                    $treeviewContainer.find('.cam-taxpicker-expander').removeClass('collapsed').addClass('expanded');
                    that.loadGroup(termStore.get_id().toString(), $treeviewContainer.find('li').first());
                } else {
                    that.doneExpandingNodes();
                }
            });
        },

        loadGroup: function (termStoreId, $container) {
            var that = this;
            var termStoreCachedObject = this.Taxonomy.CacheManager.getCache(termStoreId);
            var termStore = termStoreCachedObject.item;

            this.Taxonomy.loadGroups(termStore).then(function (groups) {
                var groupsEnumerator = groups.getEnumerator();
                var firstItemFound = false;

                while (groupsEnumerator.moveNext()) {
                    var group = groupsEnumerator.get_current();
                    var cacheObject = { item: group, firstLoad: true };

                    that.Taxonomy.CacheManager.updateCache(group.get_id().toString(), cacheObject);

                    if (!firstItemFound) {
                        $container.append(jQuery('<ul class="cam-taxpicker-treenode-ul root"></ul>'));
                        $container = $container.find("ul");
                        firstItemFound = true;
                    }

                    buildTreeView($container, CAMControl.TAXONOMYENUM.Group, group.get_id().toString(), group.get_name(), true, false);
                }

                that.enableClickEventOnNode($container);

                if (that.Taxonomy.GroupId) {
                    that.Taxonomy.CacheManager.getCache(that.Taxonomy.GroupId).firstLoad = false;

                    var $groupContainer = $container.find('div[data-id="' + that.Taxonomy.GroupId + '"]').closest('li');

                    $groupContainer.find('.cam-taxpicker-expander').removeClass('collapsed').addClass('expanded');

                    that.loadTermSet(that.Taxonomy.GroupId, $groupContainer);
                } else {
                    that.doneExpandingNodes();
                }
            });
        },

        loadTermSet: function (groupId, $container) {
            var that = this;
            var groupCachedObject = this.Taxonomy.CacheManager.getCache(groupId);
            var group = groupCachedObject.item;

            this.Taxonomy.loadTermSets(group).then(function (termSets) {
                var termSetsEnumerator = termSets.getEnumerator();
                var firstItemFound = false;

                while (termSetsEnumerator.moveNext()) {
                    var termSet = termSetsEnumerator.get_current();
                    var cacheObject = { item: termSet, firstLoad: true };

                    that.Taxonomy.CacheManager.setCache(termSet.get_id().toString(), cacheObject);

                    if (!firstItemFound) {
                        $container.append(jQuery('<ul class="cam-taxpicker-treenode-ul root"></ul>'));
                        $container = $container.find("ul");
                        firstItemFound = true;
                    }

                    buildTreeView($container, CAMControl.TAXONOMYENUM.TermSet, termSet.get_id().toString(), termSet.get_name(), true, true);
                }

                that.enableClickEventOnNode($container);

                if (that.Taxonomy.TermSetId) {
                    that.Taxonomy.CacheManager.getCache(that.Taxonomy.TermSetId).firstLoad = false;
                    
                    var $termSetNode = $container.find('div[data-id="' + that.Taxonomy.TermSetId + '"]');
                    var $termSetContainer = $termSetNode.closest('li');

                    $termSetContainer.find('.cam-taxpicker-expander').removeClass('collapsed').addClass('expanded');

                    if (!that.Taxonomy.AnchorId) {
                        if ($termSetNode.data("id") === that.Taxonomy.TermSetId) {
                            var term = new Term();

                            term.id = $termSetNode.data("id");
                            term.name = $termSetNode.find("span").text();

                            $termSetNode.addClass("selected");
                            that._dlgCurrTermNode = $termSetNode;

                           that.addHighlightedTermToSelection(term);
                        }

                        that.doneExpandingNodes();
                    }

                    that.loadTerm(that.Taxonomy.TermSetId, $termSetContainer);
                } else {
                    that.doneExpandingNodes();
                }
            });
        },

        loadTermSetAsRoot: function (termSet, $container) {
            var that = this;

            spContext.load(termSet);

            this.Taxonomy.executeQuery(termSet).then(function (termSet) {
                var cacheObject = { item: termSet, firstLoad: true };

                that.Taxonomy.CacheManager.updateCache(termSet.get_id().toString(), cacheObject);

                buildTreeView($container, CAMControl.TAXONOMYENUM.TermSet, termSet.get_id().toString(), termSet.get_name(), true, false);

                that.enableClickEventOnNode($container);

                that.doneExpandingNodes();
            });
        },

        loadTermAsRoot: function (term, $container) {
            var that = this;

            spContext.load(term);

            this.Taxonomy.executeQuery(term).then(function (term) {
                var cacheObject = { item: term, firstLoad: true };

                that.Taxonomy.CacheManager.updateCache(term.get_id().toString(), cacheObject);

                buildTreeView($container, CAMControl.TAXONOMYENUM.Term, term.get_id().toString(), term.get_name(), true, false);

                that.enableClickEventOnNode($container);

                that.doneExpandingNodes();
            });
        },

        loadTerm: function (termSetId, $container) {
            var that = this;
            var termSetCachedObject = this.Taxonomy.CacheManager.getCache(termSetId);
            var termSet = termSetCachedObject.item;

            this.Taxonomy.loadTerms(termSet).done(function (terms) {
                var termsEnumerator = terms.getEnumerator();
                var firstItemFound = false;

                while (termsEnumerator.moveNext()) {
                    var term = termsEnumerator.get_current();
                    var termId = term.get_id().toString();
                    var termName = term.get_name();
                    var cacheObject = { item: term, firstLoad: true };

                    that.Taxonomy.CacheManager.updateCache(termId, cacheObject);

                    if (!firstItemFound) {
                        $container.append(jQuery('<ul class="cam-taxpicker-treenode-ul root"></ul>'));
                        $container = $container.find("ul");
                        firstItemFound = true;
                    }
                    
                    var hasChildren = term.get_termsCount() > 0;
                    var selectable = true;

                    if (that._controlMode === "designer" && !hasChildren) {
                        selectable = false;
                    }

                    buildTreeView($container, CAMControl.TAXONOMYENUM.Term, termId, termName, hasChildren, selectable);

                    var $termNode = $container.find('div[data-id="' + termId + '"]');
                    var $termContainer = $termNode.closest('li');

                    if (termId === that.Taxonomy.AnchorId) {
                        var term = new Term();

                        term.id = termId;
                        term.name = termName;

                        that._dlgCurrTermNode = $termNode;

                        that.addHighlightedTermToSelection(term);

                        $termNode.addClass("selected");
                        that.doneExpandingNodes();   
                    } else {
                        if (that.Taxonomy.AnchorPath && that.Taxonomy.AnchorPath.length > 0) {
                            var paths = that.Taxonomy.AnchorPath.split("/");
                            var startIndex = paths.indexOf(termId);

                            if (startIndex > -1 && startIndex < paths.length - 1) {
                                that.Taxonomy.CacheManager.getCache(termId).firstLoad = false;
                                that.loadTerm(paths[startIndex], $termContainer);
                            }
                        }
                    }
                }

                that.enableClickEventOnNode($container);
            });
        },

        doneExpandingNodes: function () {
            this._expandingNodes = false;
            this.Taxonomy.Loaded = true;
            jQuery('body').find('.cam-taxpicker-dialog-waiting-container').remove();
            jQuery('body').find('.cam-taxpicker-dialog-tree-container').show();
        },

        enableClickEventOnNode: function ($container) {
            var that = this;

            $container.find('.cam-taxpicker-expander').click(function () {
                //toggle tree node
                if (jQuery(this).hasClass('expanded')) {
                    jQuery(this).removeClass('expanded');
                    jQuery(this).addClass('collapsed');
                    jQuery(this).parent().next().hide();
                }
                else if (jQuery(this).hasClass('collapsed')) {
                    jQuery(this).removeClass('collapsed');
                    jQuery(this).addClass('expanded');
                    jQuery(this).parent().next().show();

                    var $node = jQuery(this).parent().find(".cam-taxpicker-treenode-title");
                    var nodeId = $node.data("id");
                    var nodeType = $node.data("type");

                    var cachedObject = that.Taxonomy.CacheManager.getCache(nodeId);
                    
                    if (cachedObject && !cachedObject.firstLoad) {
                        return;
                    }

                    cachedObject.firstLoad = false;

                    that.Taxonomy.CacheManager.setCache(nodeId, cachedObject);

                    var childType = that.getChildType(nodeType);
                    that["load" + childType].call(that, nodeId, $node.closest("li"));
                }
            });

            jQuery('.cam-taxpicker-treenode-title').click(Function.createDelegate(this, this.termNodeClicked));
            jQuery('.cam-taxpicker-treenode-title').dblclick(Function.createDelegate(this, this.termNodeDoubleClicked));
        },

        getChildType: function (type) {
            switch (type) {
                case CAMControl.TAXONOMYENUM.TermStore:
                    return CAMControl.TAXONOMYENUM.Group;
                case CAMControl.TAXONOMYENUM.Group:
                    return CAMControl.TAXONOMYENUM.TermSet;
                default:
                    return CAMControl.TAXONOMYENUM.Term;
            }
        },

        //closes the picker dialog
        closePickerDialog: function (event) {
            jQuery('body').children('.cam-taxpicker-dialog').remove();
        },

        //adds a new term to the end of this._selectedTerms
        pushSelectedTerm: function (term) {
            if (!this.existingTerm(term)) {
                //pop the existing term if this isn't a multi-select
                if (!this._isMulti)
                    this.popSelectedTerm();

                //add the term to the selected terms array            
                this._selectedTerms.push(term);
                this._hiddenValidated.val(JSON.stringify(this._selectedTerms));
                //added to trigger change event 
                this._hiddenValidated.trigger('change');
            }
        },

        //if the term already exists in the selected terms then don't add it
        existingTerm: function (term) {
            for (var j = 0; j < this._selectedTerms.length; j++) {
                if (this._selectedTerms[j].id == term.id) {
                    return true;
                }
            }
            return false;
        },

        //removes the last term from this._selectedTerms
        popSelectedTerm: function () {
            //remove the last selected term
            this._selectedTerms.pop();
            this._hiddenValidated.val(this.getSelectedTermsValue(this._selectedTerms));
            //added to trigger change event 
            this._hiddenValidated.trigger('change');
        },

        getSelectedTermsValue: function (selectedTerms) {
            if (this._controlMode === "designer" ) {
                return JSON.stringify(selectedTerms);
            } else {
                var selectedValues = [];

                for (var i = 0; i < selectedTerms.length; i++) {
                    selectedValues.push(selectedTerms[i].name + "|" + selectedTerms[i].id);
                }

                return selectedValues.join(";");
            }
        },

        //converts this._selectedTerms to html for an editor field
        selectedTermsToHtml: function () {
            var termsHtml = '';
            for (var i = 0; i < this._selectedTerms.length; i++) {
                var e = this._selectedTerms[i];
                termsHtml += '<span class="cam-taxpicker-term-selected">' + e.name + '</span><span>;&nbsp;</span>';
            }
            return termsHtml;
        },

        //converts this._selectedTerms to array for external applications use.
        selectedTermNamesToArray: function () {
            var termsArray = [];
            for (var i = 0; i < this._selectedTerms.length; i++) {
                var e = this._selectedTerms[i];
                termsArray.push(e.name);
            }
            return termsArray;
        },

        //trim suggestions based on existing selections
        trimSuggestions: function (suggestions) {
            var trimmedSuggestions = new Array();
            for (var i = 0; i < suggestions.length; i++) {
                var suggestion = suggestions[i];
                var found = false;
                for (var j = 0; j < this._selectedTerms.length; j++) {
                    if (this._selectedTerms[j].id == suggestion.id) {
                        found = true;
                        break;
                    }
                }

                //add the suggestion if it was not found
                if (!found)
                    trimmedSuggestions.push(suggestion);
            }

            return trimmedSuggestions;
        }
    });

    function buildTreeView($container, taxonomyType, id, name, hasChildren, selectable) {
        var expander = hasChildren ? "collapsed" : "";
        var html = '<li class="cam-taxpicker-treenode-li">' +
                        '<div class="cam-taxpicker-treenode">' +
                            '<div class="cam-taxpicker-expander ' + expander + '">' +
                            '</div>' +
                            '<div class="cam-taxpicker-treenode-icon ' + taxonomyType.toLowerCase() + '"></div>' +
                            '<div class="cam-taxpicker-treenode-title ' + taxonomyType.toLowerCase() + '" ' + 
                                'data-id="' + id + '" ' + 
                                'data-type="' + taxonomyType+ '" ' + 
                                'data-name="' + name + '" ' + 
                                'data-selectable="' + selectable + '"><span>' + name + '</span></div>' +
                        '</div>'
                    '</li>';
        
        $container.append(jQuery(html));
    }

    //creates a new guid
    function newGuid() {
        var result, i, j;
        result = '';
        for (j = 0; j < 32; j++) {
            if (j == 8 || j == 12 || j == 16 || j == 20)
                result = result + '-';
            i = Math.floor(Math.random() * 16).toString(16).toUpperCase();
            result = result + i;
        }
        return result
    }

    jQuery.fn.taxpicker = function (options, sharepointContext, changeCallback) {
        if (!sharepointContext) {
            return this;
        }

        if (!this.length) {
            return this;
        }

        if (this[0].tagName.toLowerCase() != 'input' || this[0].type.toLowerCase() != 'hidden')
            return this;

        spContext = sharepointContext;

        if (jQuery.taxpicker == undefined) {
            jQuery.taxpicker = [];
        }

        //create new TaxonomyPicker instance and increment index (in case we need to re-reference)
        options.taxPickerIndex = taxIndex;
        jQuery.taxpicker[taxIndex] = new TaxonomyPicker(this, options, ctx, changeCallback);
        taxIndex++;
    };

})();