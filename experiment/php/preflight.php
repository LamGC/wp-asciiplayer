<?php
// Experiment only: a lexical resource gate, NOT a replacement JSON validator.
// Constant scanner state; no token list and no decoded object graph.
function preflight_budget($text, $container_limit = 100016, $token_limit = 400000) {
    $n = strlen($text); $containers = 0; $tokens = 0; $depth = 0;
    $in_string = false; $escaped = false; $in_atom = false;
    for ($i = 0; $i < $n; ++$i) {
        $c = $text[$i];
        if ($in_string) {
            if ($escaped) { $escaped = false; }
            elseif ($c === '\\') { $escaped = true; }
            elseif ($c === '"') { $in_string = false; }
            continue;
        }
        if ($c === '"') { $in_string = true; $in_atom = false; ++$tokens; }
        elseif ($c === '{' || $c === '[') {
            $in_atom = false; ++$containers; ++$depth;
            if ($depth > 15) return array('ok'=>false,'reason'=>'depth','offset'=>$i,'containers'=>$containers,'tokens'=>$tokens);
        }
        elseif ($c === '}' || $c === ']') { --$depth; $in_atom = false; }
        elseif ($c === ',' || $c === ':' || $c === ' ' || $c === "\n" || $c === "\r" || $c === "\t") { $in_atom = false; }
        elseif (!$in_atom) { ++$tokens; $in_atom = true; }
        if ($containers > $container_limit || $tokens > $token_limit) {
            return array('ok'=>false,'reason'=>$containers > $container_limit ? 'containers' : 'tokens','offset'=>$i,'containers'=>$containers,'tokens'=>$tokens);
        }
    }
    return array('ok'=>true,'reason'=>'within_budget','offset'=>$n,'containers'=>$containers,'tokens'=>$tokens);
}
