#!/bin/bash

####descarga optimizada de las 52 url de las provincias

# Set the username and password
username="usrcata066"
password="ahK4gai9"

# Get the latest sending number
####sending=$(curl --tlsv1.2 -u "$username:$password" "https://repositorimitjans.eleccionsparlament.cat/descargas/csv/data/getEnvio/509")

# Define the list of specific numbers you need
numbers="08 17 25 43"

# Loop through the specified numbers
####for i in $numbers; do
####  # Construct the URL
####  url="https://repositorimitjans.eleccionsparlament.cat/descargas/csv/data/getEscrutinioMunicipios/509/$i/$sending"

####  # Download the CSV file using TLS 1.2 and authentication
####  curl --tlsv1.2 -u "$username:$password" "$url" -o "file$i.csv"
####done

# Wait for 5 seconds to ensure all files are downloaded
####sleep 5

# Merge the CSV files into a single file
cat file*.csv > merged_file.csv

# Concatenate columns 2 and 4 and add as new column
awk -F ';' -v OFS=';' '{print $3 $5, $0}' merged_file.csv > temp_file.csv && mv temp_file.csv merged_file2.csv

# Delete all rows that don't have the value '99' on column 7
awk -F ';' '$7 == "99"' merged_file2.csv > temp_file.csv && mv temp_file.csv merged_file3.csv

# Replace codes with names in columns 24, 29, 34, 39, 44, and 49 (hasta 222, candidatura 50) -- UNO MENOS EN PARLAMENT 4 DE SEPARACION
awk -F ';' 'BEGIN{OFS=";"} NR==FNR{a[$1]=$2;next}{for(i=23;i<=222;i+=4)gsub($i,a[$i],$i)}1' party_names.csv merged_file3.csv > temp_file.csv && mv temp_file.csv merged_file4.csv

# Add headers from separate CSV file
cat headers_mas_1.csv merged_file4.csv > temp_file.csv && mv temp_file.csv merged_file5.csv

##### añadir punto a los decimales

# Function to check if a column header starts with 'pc'
is_pc_column() {
  local header=$1
  if [[ ${header:0:2} == "pc" ]]; then
    return 0
  else
    return 1
  fi
}

# Function to add a decimal point to the specified columns
add_decimal_point() {
  local input_file=$1
  local output_file=$2
  local pc_columns=()

  # Read the headers from the CSV file
  headers=$(head -n 1 "$input_file")

  # Identify the columns that need to be modified
  IFS=';' read -ra header_array <<< "$headers"
  for i in "${!header_array[@]}"; do
    if is_pc_column "${header_array[i]}"; then
      pc_columns+=("$((i+1))")
    fi
  done

  # Add the decimal point to the specified columns
  awk -F ';' -v OFS=';' -v pc_columns="${pc_columns[*]}" '
    BEGIN {
      split(pc_columns, pc_col_array, " ")
    }
    {
      for (i in pc_col_array) {
        col = pc_col_array[i]
        if (NR > 1 && $col != "") {
          $col = substr($col, 1, length($col) - 2) "." substr($col, length($col) - 1)
        }
      }
      print
    }
  ' "$input_file" > "$output_file"
}

add_decimal_point merged_file5.csv temp_file.csv && mv temp_file.csv merged_file6.csv

# limpia los saltos de linea https://askubuntu.com/questions/803162/how-to-change-windows-line-ending-to-unix-version
echo "$(tr -d '\r' < merged_file6.csv)" > merged_file6.csv

####### columnas nuevas

# Function to add main party columns and fill them with voting percentages
add_main_party_columns() {
  local input_file=$1
  local output_file=$2
  local main_parties=("PSC" "Comuns" "PP" "Vox" "CUP" "Junts" "AC" "Cs" "ERC" "Alhora")

  # Add new columns for main parties
  awk -F ';' -v OFS=';' -v main_parties="${main_parties[*]}" '
    BEGIN {
      split(main_parties, main_party_array, " ")
      header_line = 1
    }
    {
      if (header_line) {
        for (i in main_party_array) {
          $0 = $0 OFS main_party_array[i]
        }
        header_line = 0
      } else {
        new_values = ""
        for (i in main_party_array) {
          party = main_party_array[i]
          found = 0
          for (j = 23; j <= 222; j += 4) {
            if ($j == party) {
              new_values = (new_values == "" ? "" : new_values ";") $(j + 3)
              found = 1
              break
            }
          }
          if (!found) {
            new_values = (new_values == "" ? "0" : new_values ";0")
          }
        }
        $0 = $0 OFS new_values
      }
      print
    }
  ' "$input_file" > "$output_file"
}

add_main_party_columns merged_file6.csv temp_file.csv && mv temp_file.csv merged_file7.csv

## y añadir columnas de votos

# Function to add main party columns and fill them with votes
add_main_party_columns() {
  local input_file=$1
  local output_file=$2
  local main_parties=("PSC" "Comuns" "PP" "Vox" "CUP" "Junts" "AC" "Cs" "ERC" "Alhora")

  # Add new columns for main parties
  awk -F ';' -v OFS=';' -v main_parties="${main_parties[*]}" '
    BEGIN {
      split(main_parties, main_party_array, " ")
      header_line = 1
    }
    {
      if (header_line) {
        for (i in main_party_array) {
          $0 = $0 OFS main_party_array[i]
        }
        header_line = 0
      } else {
        new_values = ""
        for (i in main_party_array) {
          party = main_party_array[i]
          found = 0
          for (j = 23; j <= 222; j += 4) {
            if ($j == party) {
              new_values = (new_values == "" ? "" : new_values ";") $(j + 2)
              found = 1
              break
            }
          }
          if (!found) {
            new_values = (new_values == "" ? "0" : new_values ";0")
          }
        }
        $0 = $0 OFS new_values
      }
      print
    }
  ' "$input_file" > "$output_file"
}

add_main_party_columns merged_file7.csv temp_file.csv && mv temp_file.csv merged_file8.csv


# limpia los saltos de linea https://askubuntu.com/questions/803162/how-to-change-windows-line-ending-to-unix-version
echo "$(tr -d '\r' < merged_file8.csv)" > merged_file8.csv

# saca las 52 capitales de provincia
INPUT_FILE="merged_file8.csv"
OUTPUT_FILE="capitales_prov_file.csv"
IDS=("01059" "02003" "03014" "04013" "05019" "06015" "07040" "08019" "09059" "10037" "11012" "12040" "13034" "14021" "15030" "16078" "17079" "18087" "19130" "20069" "21041" "22125" "23050" "24089" "25120" "26089" "27028" "28079" "29067" "30030" "31201" "32054" "33044" "34120" "35016" "36038" "37274" "38038" "39075" "40194" "41091" "42173" "43148" "44216" "45168" "46250" "47186" "48020" "49275" "50297" "51001" "52001")

# Generate column headers for output file
HEADERS=$(head -n 1 "${INPUT_FILE}")
echo "${HEADERS}" > "${OUTPUT_FILE}"

# Iterate over IDs and filter lines based on ID
for id in "${IDS[@]}"; do
  grep "^${id};" "${INPUT_FILE}" >> "${OUTPUT_FILE}"
done

############
# saca el área metropolitana
INPUT_FILE="merged_file8.csv"
OUTPUT_FILE="amb_file.csv"
IDS=("08015" "08019" "08020" "08054" "08056" "08068" "08072" "08073" "08077" "08089" "08101" "08123" "08125" "08126" "08157" "08158" "08169" "08180" "08194" "08196" "08200" "08204" "08205" "08211" "08217" "08221" "08244" "08245" "08252" "08263" "08266" "08282" "08289" "08301" "08904" "08905")

# Generate column headers for output file
HEADERS=$(head -n 1 "${INPUT_FILE}")
echo "${HEADERS}" > "${OUTPUT_FILE}"

# Iterate over IDs and filter lines based on ID
for id in "${IDS[@]}"; do
  grep "^${id};" "${INPUT_FILE}" >> "${OUTPUT_FILE}"
done
##################
# saca la 15 mas pobladas de Catalunya
INPUT_FILE="merged_file8.csv"
OUTPUT_FILE="15mas.csv"
IDS=("08019" "08101" "08279" "08015" "08187" "25120" "43148" "08121" "08245" "43123" "17079" "08205" "08073" "08200" "08184")

# Generate column headers for output file
HEADERS=$(head -n 1 "${INPUT_FILE}")
echo "${HEADERS}" > "${OUTPUT_FILE}"

# Iterate over IDs and filter lines based on ID
for id in "${IDS[@]}"; do
  grep "^${id};" "${INPUT_FILE}" >> "${OUTPUT_FILE}"
done
##################

# quitar espacios antes y despues (trim)
function remove_trailing_spaces() {
  local input_file="$1"
  local output_file="$2"
  local separator="$3"

  awk -F "${separator}" -v OFS="${separator}" '
    {
      for (i = 1; i <= NF; i++) {
        sub(/[[:space:]]+$/, "", $i);
      }
      print;
    }
  ' "${input_file}" > "${output_file}"
}

input_file="csv276.csv"
output_file="merged_file_no_trailing_spaces.csv"
separator=";"

remove_trailing_spaces "${input_file}" "${output_file}" "${separator}"

mv "${output_file}" "${input_file}"

##sacar catalunya
#extraer para sumas de % de voto indep-no indep
cut -d ';' -f 1,3,8,224,225,226,227,228,229,230,231,232,233 merged_file8.csv > sumasindep.csv

###### ESTO NO HACE FALTA AHORA SOLO EN CAT
# Delete all rows that don't have the value '09' en la columna CCAA
###### awk -F ';' 'NR==1 || $2 == "09"' sumasindep.csv > temp_file.csv && mv temp_file.csv sumasindep.csv

####sumas NOINDEP
input_file="sumasindep.csv"
output_file="sumasindephechas.csv"

# Set the locale to ensure correct decimal handling
export LC_ALL=C

# Add the new column header 'noindep' to the output file
header=$(head -n 1 "$input_file" | tr -d '\r\n')
echo "noindep;${header}" > "$output_file"

# Process the input file line by line, skipping the header
tail -n +2 "$input_file" | awk -F';' '{
    # Initialize variables for columns que se suman
    col4 = ($4 != "" ? $4 : 0)
    col5 = ($5 != "" ? $5 : 0)
    col6 = ($6 != "" ? $6 : 0)
    col10 = ($10 != "" ? $10 : 0)
    col13 = ($13 != "" ? $13 : 0)

    # Suma las columnas, keeping two decimal places
    sum = sprintf("%.2f", col4 + col5 + col6 + col10 + col13)

    # Print the new 'noindep' column followed by the original line
    print sum ";" $0
}' >> "$output_file"

####sumas INDEP (ojo porque el csv lleva la columna noindep y hay que añadir 1 columna al número de columna)
input_file="sumasindephechas.csv"
output_file="sumasindephechasOK.csv"

# Set the locale to ensure correct decimal handling
export LC_ALL=C

# Add the new column header 'noindep' to the output file
header=$(head -n 1 "$input_file" | tr -d '\r\n')
echo "indep;${header}" > "$output_file"

# Process the input file line by line, skipping the header
tail -n +2 "$input_file" | awk -F';' '{
    # Initialize variables for columns que se suman
    col8 = ($8 != "" ? $8 : 0)
    col9 = ($9 != "" ? $9 : 0)
    col10 = ($10 != "" ? $10 : 0)
    col12 = ($12 != "" ? $12 : 0)
    col13 = ($13 != "" ? $13 : 0)

    # Suma las columnas, keeping two decimal places
    sum = sprintf("%.2f", col8 + col9 + col10 + col12 + col13)

    # Print the new 'indep' column followed by the original line
    print sum ";" $0
}' >> "$output_file"

####sumas EXTREMA DERECHA (ojo al número de columna porque el csv lleva la columna indep y noindep)
input_file="sumasindephechasOK.csv"
output_file="sumasindephechasOKextrema.csv"

# Set the locale to ensure correct decimal handling
export LC_ALL=C

# Add the new column header 'noindep' to the output file
header=$(head -n 1 "$input_file" | tr -d '\r\n')
echo "extremaderecha;${header}" > "$output_file"

# Process the input file line by line, skipping the header
tail -n +2 "$input_file" | awk -F';' '{
    # Initialize variables for columns que se suman
    col8 = ($8 != "" ? $8 : 0)
    col11 = ($11 != "" ? $11 : 0)

    # Suma las columnas, keeping two decimal places
    sum = sprintf("%.2f", col8 + col11)

    # Print the new 'extremaderecha' column followed by the original line
    print sum ";" $0
}' >> "$output_file"

##########################

##sacar catalunya
#extraer para variacion-votos
cut -d ';' -f 1,3,8,234,235,236,237,238,239,240,241,242,243 merged_file8.csv > variacionvoto.csv

# Delete all rows that don't have the value '99' on column 7
awk -F ';' 'NR==1 || $2 == "09"' variacionvoto.csv > temp_file.csv && mv temp_file.csv variacionvoto.csv

##################
##sacar catalunya
#extraer para variacion-escaños
##cut -d ';' -f 1,3,8,300,301,302,303,304,305,306,307,308,309,310 merged_file.csv > variacionescons.csv

# Delete all rows that don't have the value '99' on column 7
##awk -F ';' 'NR==1 || $2 == "09"' variacionescons.csv > temp_file.csv && mv temp_file.csv variacionescons.csv
###################

#extraer ganador
cut -d ';' -f 1,3,8,23,24,25,26 merged_file8.csv > ganador.csv

###### ESTO NO HACE FALTA AHORA SOLO EN CAT
#ganador solo CAT
######awk -F ';' 'NR==1 || $2 == "09"' ganador.csv > temp_file.csv && mv temp_file.csv ganadorcat.csv

#en ganador.csv, cambiar lo que no sea principales por otros
awk -F ';' '{if($4 !~ /^(PSC|Comuns|PP|Vox|CUP|Junts|AC|Cs|ERC|Alhora)$/) $4="Otros"; print}' OFS=';' ganador.csv > updated_ganador.csv

###### ESTO NO HACE FALTA AHORA SOLO EN CAT
#en ganadorcat.csv, cambiar lo que no sea principales por otros
###### awk -F ';' '{if($4 !~ /^(PSC|Comuns|PP|Vox|CUP|Junts|AC|Cs|ERC)$/) $4="Otros"; print}' OFS=';' ganadorcat.csv > updated_ganadorcat.csv

#en capitales_prov_file.csv, cambiar lo que no sea principales por otros
##### awk -F ';' '{if($23 !~ /^(PSC|Comuns|PP|Vox|CUP|Junts|AC|Cs|ERC)$/) $23="Otros"; print}' OFS=';' capitales_prov_file.csv > updated_capitales_prov_file.csv
# con NR == 1 no hace el cambio en la línea 1 header/encabezado
awk -F ';' 'NR == 1 || ($23 !~ /^(PSC|Comuns|PP|Vox|CUP|Junts|AC|Cs|ERC|Alhora)$/) {$23="Otros"} {print}' OFS=';' capitales_prov_file.csv > updated_capitales_prov_file.csv

#en amb_file.csv, cambiar lo que no sea principales por otros
awk -F ';' '{if($23 !~ /^(PSC|Comuns|PP|Vox|CUP|Junts|AC|Cs|ERC|Alhora)$/) $23="Otros"; print}' OFS=';' amb_file.csv > updated_amb_file.csv

#en 15mas.csv, cambiar lo que no sea principales por otros
awk -F ';' '{if($23 !~ /^(PSC|Comuns|PP|Vox|CUP|Junts|AC|Cs|ERC|Alhora)$/) $23="Otros"; print}' OFS=';' 15mas.csv > updated_15mas.csv
