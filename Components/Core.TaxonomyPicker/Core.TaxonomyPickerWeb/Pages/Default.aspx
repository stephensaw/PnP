<%@ Page Language="C#" AutoEventWireup="true" CodeBehind="Default.aspx.cs" Inherits="Contoso.Core.TaxonomyPickerWeb.Default" %>

<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">

<html xmlns="http://www.w3.org/1999/xhtml">
<head runat="server">
    <title>TaxonomyPicker Samples</title>
    <script src="../Scripts/jquery-1.9.1.min.js" type="text/javascript"></script>
    <link rel="Stylesheet" type="text/css" href="../Styles/taxonomypickercontrol.css" />
    <script src="../Scripts/app.js?rev=2404" type="text/javascript"></script>
    <script src="../Scripts/taxonomypickercontrol.js?rev=2404" type="text/javascript"></script>
    <script src="https://ajax.aspnetcdn.com/ajax/4.6/1/MicrosoftAjax.debug.js" type="text/javascript"></script>

<%--    <script src="../Scripts/app2.js?rev=2404" type="text/javascript"></script>
    <link href="../Styles/jquery.miller.css" rel="stylesheet" />
    <script src="../Scripts/jquery.miller.js"></script>--%>
</head>
<body>
        <%--<asp:ScriptManager ID="ScriptManager1" runat="server" EnableCdn="True" />--%>
        <div id="divSPChrome"></div>
        <div style="left: 50%; width: 600px; margin-left: -300px; position: absolute;">
            <input type="hidden" id="taxPickerContinent" />
        </div>

        <div style="left: 50%; width: 600px; margin-left: -300px; position: absolute; margin-top: 50px">
            <button id="doStuff">Do stuff</button>
        </div>

        <div style="left: 50%; width: 600px; margin-left: -300px; position: absolute; margin-top: 90px">
            <h3>Filler</h3>
            <input type="hidden" id="taxPickerFiller" />
        </div>
</body>
</html>
